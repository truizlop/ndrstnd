#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { getCodexAuthStatus } from "./codex.js";
import { analyzeWithCodex } from "./analyze.js";
import { importConversation } from "./conversation.js";
import { GitReader, describeReviewScope } from "./git.js";
import { ReviewStore } from "./store.js";
import { installSkill } from "./skill.js";
import { writeReviewArtifact } from "./artifact.js";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const [command, ...args] = process.argv.slice(2);

if (command === undefined || command === "--help" || command === "-h") {
  printHelp();
} else if (command === "auth") {
  await runAuth(args);
} else if (command === "skill") {
  await runSkill(args);
} else if (command === "review") {
  await runReview(args);
} else {
  fail(`Unknown command: ${command}`);
}

async function runSkill(args: string[]): Promise<void> {
  if (args[0] !== "install") fail("Usage: ndrstnd skill install [--force]");
  const destination = await installSkill(args.includes("--force"));
  process.stdout.write(`Installed the ndrstnd Codex skill at ${destination}.\n`);
}

async function runAuth(args: string[]): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status") {
    const status = await getCodexAuthStatus();
    if (status.state === "signed-in") process.stdout.write(`Codex authentication is ready (${status.accountType}).\n`);
    else if (status.state === "signed-out") process.stdout.write("Codex is not signed in. Run `ndrstnd auth login`.\n");
    else process.stdout.write(`Codex authentication could not be checked: ${status.reason}\n`);
    return;
  }
  if (action === "login") {
    const beforeLogin = await getCodexAuthStatus();
    if (beforeLogin.state === "signed-in") {
      process.stdout.write(`Codex authentication is already ready (${beforeLogin.accountType}).\n`);
      return;
    }
    await runCodexLogin();
    const afterLogin = await getCodexAuthStatus();
    if (afterLogin.state === "signed-in") process.stdout.write(`Codex authentication is ready (${afterLogin.accountType}).\n`);
    else fail("Codex login completed but ndrstnd could not validate an authenticated app-server connection.");
    return;
  }
  fail(`Unknown auth action: ${action}`);
}

async function runCodexLogin(): Promise<void> {
  const child = spawn("codex", ["login"], { stdio: "inherit" });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode ?? 1;
  }
}

async function runReview(args: string[]): Promise<void> {
  const targetArg = extractTargetRef(args);
  const uncommitted = args.includes("--uncommitted");
  const explicitBase = optionValue(args, "--base");
  if (uncommitted && explicitBase !== undefined) fail("--uncommitted already reviews against HEAD; do not combine it with --base.");
  if (uncommitted && targetArg !== undefined) fail("--uncommitted reviews the checked-out branch; do not pass a branch.");
  const targetRef = targetArg ?? "WORKTREE";
  const noOpen = args.includes("--no-open");
  const repoPath = optionValue(args, "--repo") ?? process.cwd();
  const baseRef = uncommitted ? "HEAD" : explicitBase;
  const lensId = optionValue(args, "--lens") ?? "default";
  const conversationPath = optionValue(args, "--conversation");
  const conversation = conversationPath === undefined ? undefined : await importConversation(conversationPath);
  const input = await new GitReader().collectReviewInput(repoPath, targetRef, baseRef);
  const meaningfulFiles = input.files.filter((file) => file.signal === "meaningful").length;
  const scope = await describeReviewScope(repoPath, input);
  process.stdout.write(`Reviewing ${scope.targetLabel} against ${input.baseRef}${input.includesWorkingTree ? ", including uncommitted changes" : ""} — ${input.files.length} changed file${input.files.length === 1 ? "" : "s"} (${meaningfulFiles} meaningful).\n`);
  if (baseRef === undefined && input.includesWorkingTree && scope.localCommitsIncluded > 0) {
    process.stdout.write(`Warning: the inferred base ${input.baseRef} is ${scope.localCommitsIncluded} commit${scope.localCommitsIncluded === 1 ? "" : "s"} behind ${scope.targetLabel}, so those commits are included. Pass --base to narrow the review, or --uncommitted for only uncommitted changes.\n`);
  }
  const store = openReviewStore();
  const lens = store.getLens(lensId);
  if (lens === undefined) fail(`Unknown review lens: ${lensId}`);
  const session = store.getOrCreateSession(input, conversation);
  let revision = store.listRevisions(session.id).find((candidate) => candidate.source === "codex");
  if (revision === undefined) {
    const auth = await getCodexAuthStatus();
    if (auth.state === "signed-out") fail("Codex is not signed in, so ndrstnd cannot analyze this change. Run `ndrstnd auth login` first.");
    if (auth.state === "unreachable") fail(`Codex could not be reached, so ndrstnd cannot analyze this change: ${auth.reason}`);
    process.stdout.write("Drafting the review narrative with Codex…\n");
    try {
      const document = await analyzeWithCodex(input, conversation, undefined, lens.instructions);
      revision = store.createRevision(session.id, "codex", "complete", document);
    } catch (error) {
      store.close();
      fail(`Codex analysis failed, so no review artifact was written: ${error instanceof Error ? error.message : String(error)} Nothing was persisted; re-run the same ndrstnd review command to retry.`);
    }
  }
  process.stdout.write(`merge-base=${input.mergeBase.slice(0, 12)} files=${input.files.length} meaningful-files=${meaningfulFiles} hunks=${input.hunks.length}${conversation === undefined ? "" : ` conversation=${conversation.messages.length}`}\n`);
  const artifactPath = await writeReviewArtifact(session, revision, { directory: join(repoPath, ".ndrstnd") });
  process.stdout.write(`ndrstnd artifact: ${artifactPath}\n`);
  process.stdout.write("This self-contained file is in the Git-ignored .ndrstnd directory and expires after seven days.\n");
  if (!noOpen) openBrowser(pathToFileURL(artifactPath).href);
  store.close();
}

function openReviewStore(): ReviewStore {
  try {
    return new ReviewStore();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint = /NODE_MODULE_VERSION|compiled against a different Node\.js version/.test(message)
      ? ` The review store's native SQLite module was built for a different Node.js than the current ${process.versions.node}; run \`npm rebuild better-sqlite3\` in the ndrstnd installation or reinstall ndrstnd.`
      : "";
    fail(`The ndrstnd review store could not open: ${message}${hint}`);
  }
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function extractTargetRef(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--no-open") {
      continue;
    }
    if (argument === "--repo") {
      index += 1;
      continue;
    }
    if (argument === "--conversation") {
      index += 1;
      continue;
    }
    if (argument === "--lens") {
      index += 1;
      continue;
    }
    if (argument === "--base") {
      index += 1;
      continue;
    }
    if (!argument.startsWith("-")) {
      return argument;
    }
  }
  return undefined;
}

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    fail(`${option} requires a value.`);
  }
  return value;
}

function printHelp(): void {
  process.stdout.write(`ndrstnd — understand agent-produced branch changes\n\nUsage:\n  ndrstnd auth <status|login>\n  ndrstnd skill install [--force]\n  ndrstnd review [branch] [--base <branch>] [--uncommitted] [--repo <path>] [--conversation <path>] [--lens <id>] [--no-open]\n\nWithout a branch, ndrstnd reviews the checked-out branch including uncommitted changes.\n--uncommitted reviews only the uncommitted working-tree changes (an alias for --base HEAD).\nndrstnd always writes a self-contained, Git-ignored artifact.\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
