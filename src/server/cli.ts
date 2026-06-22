#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { getCodexAuthStatus } from "./codex.js";
import { analyzeWithCodex, buildFallbackAnalysis } from "./analyze.js";
import { importConversation } from "./conversation.js";
import { GitReader } from "./git.js";
import { startReviewServer } from "./http.js";
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
  const targetRef = extractTargetRef(args) ?? "WORKTREE";
  const noOpen = args.includes("--no-open");
  const live = args.includes("--live");
  const portIndex = args.indexOf("--port");
  const port = portIndex === -1 ? 0 : parsePort(args[portIndex + 1]);
  const repoPath = optionValue(args, "--repo") ?? process.cwd();
  const baseRef = optionValue(args, "--base");
  const lensId = optionValue(args, "--lens") ?? "default";
  const conversationPath = optionValue(args, "--conversation");
  const conversation = conversationPath === undefined ? undefined : await importConversation(conversationPath);
  const input = await new GitReader().collectReviewInput(repoPath, targetRef, baseRef);
  const store = new ReviewStore();
  const lens = store.getLens(lensId);
  if (lens === undefined) fail(`Unknown review lens: ${lensId}`);
  const session = store.getOrCreateSession(input, conversation);
  let revision = store.listRevisions(session.id)[0];
  if (revision === undefined) {
    const fallback = store.createRevision(session.id, "fallback", "partial", buildFallbackAnalysis(input));
    process.stdout.write("Drafting the review narrative with Codex…\n");
    try {
      const document = await analyzeWithCodex(input, conversation, undefined, lens.instructions);
      revision = store.createRevision(session.id, "codex", "complete", document);
    } catch (error) {
      process.stdout.write(`Codex analysis was unavailable; opening the complete fallback evidence view. (${error instanceof Error ? error.message : String(error)})\n`);
      revision = fallback;
    }
  }
  const meaningfulFiles = input.files.filter((file) => file.signal === "meaningful").length;
  process.stdout.write(`merge-base=${input.mergeBase.slice(0, 12)} files=${input.files.length} meaningful-files=${meaningfulFiles} hunks=${input.hunks.length}${conversation === undefined ? "" : ` conversation=${conversation.messages.length}`}\n`);
  if (!live) {
    const artifactPath = await writeReviewArtifact(session, revision, { directory: join(repoPath, ".ndrstnd") });
    process.stdout.write(`ndrstnd artifact: ${artifactPath}\n`);
    process.stdout.write("This self-contained file is in the Git-ignored .ndrstnd directory and expires after seven days.\n");
    if (!noOpen) openBrowser(pathToFileURL(artifactPath).href);
    store.close();
    return;
  }

  const server = await startReviewServer({ port, session, revision, store });
  process.stdout.write(`ndrstnd live session: ${server.url}\n`);
  process.stdout.write("Press Ctrl-C to stop the local server.\n");
  if (!noOpen) openBrowser(server.url);
  await new Promise<void>((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  await server.close();
  store.close();
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
    if (argument === "--no-open" || argument === "--live") {
      continue;
    }
    if (argument === "--port") {
      index += 1;
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

function parsePort(value: string | undefined): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    fail("--port must be an integer from 0 through 65535.");
  }
  return port;
}

function printHelp(): void {
  process.stdout.write(`ndrstnd — understand agent-produced branch changes\n\nUsage:\n  ndrstnd auth <status|login>\n  ndrstnd skill install [--force]\n  ndrstnd review <branch> [--base <branch>] [--repo <path>] [--conversation <path>] [--lens <id>] [--no-open]\n  ndrstnd review <branch> --live [--port <number>]\n\nBy default ndrstnd writes a self-contained artifact outside the repository. Use --live only for server-backed re-analysis and questions.\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
