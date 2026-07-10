#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import process from "node:process";
import { resolveReviewAgent, reviewAgents, type ReviewAgent, type ReviewAgentId, type TurnActivity } from "./agent.js";
import { analyzeWithAgent, formatAnalysisHeartbeat, type AnalysisProgress } from "./analyze.js";
import { importConversation } from "./conversation.js";
import { GitReader, describeReviewScope, ensureArtifactDirectoryIgnored } from "./git.js";
import { ReviewStore, selectReusableRevision } from "./store.js";
import { installSkill, installedSkillIsStale } from "./skill.js";
import { writeReviewArtifact } from "./artifact.js";
import { browserOpenCommand } from "./cli-support.js";
import { packageVersion } from "./version.js";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

const [command, ...args] = process.argv.slice(2);

if (command === undefined || command === "--help" || command === "-h") {
  printHelp();
} else if (command === "--version" || command === "-v" || command === "version") {
  process.stdout.write(`ndrstnd ${await packageVersion()}\n`);
} else if (command === "auth") {
  await runAuth(args);
} else if (command === "skill") {
  await runSkill(args);
} else if (command === "review") {
  await runReview(args);
} else {
  fail(`Unknown command: ${command}`);
}


/** A typo in any flag must fail loudly; silently ignoring it would run the wrong review, agent, or install. */
function parseCommandArgs(command: string, args: string[], valueOptions: string[], booleanOptions: string[], maxPositional: number): { positional: string[]; values: Map<string, string>; flags: Set<string> } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (valueOptions.includes(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) fail(`${argument} requires a value.`);
      values.set(argument, value);
      index += 1;
      continue;
    }
    if (booleanOptions.includes(argument)) {
      flags.add(argument);
      continue;
    }
    if (argument.startsWith("-")) fail(`Unknown ${command} option: ${argument}. Known options: ${[...valueOptions, ...booleanOptions].join(", ")}.`);
    if (positional.length >= maxPositional) fail(`Unexpected extra ${command} argument: ${argument}.`);
    positional.push(argument);
  }
  return { positional, values, flags };
}

function wantsHelp(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function agentOptionFrom(values: Map<string, string>): ReviewAgentId | undefined {
  const value = values.get("--agent");
  if (value === undefined) return undefined;
  if (!reviewAgents.some((agent) => agent.id === value)) fail(`Unknown analysis agent: ${value}. Supported agents: ${reviewAgents.map((agent) => agent.id).join(", ")}.`);
  return value as ReviewAgentId;
}

async function runSkill(args: string[]): Promise<void> {
  if (wantsHelp(args)) return printHelp();
  const { positional, values, flags } = parseCommandArgs("skill", args, ["--agent"], ["--force"], 1);
  if (positional[0] !== "install") fail("Usage: ndrstnd skill install [--force] [--agent <codex|claude>]");
  const installations = await installSkill(flags.has("--force"), agentOptionFrom(values)).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
  for (const installation of installations) {
    if (installation.status === "installed") process.stdout.write(`Installed the ndrstnd skill for ${installation.agent.name} at ${installation.destination}.\n`);
    else process.stdout.write(`Skipped ${installation.agent.name}: ${installation.reason}.\n`);
  }
  if (!installations.some((installation) => installation.status === "installed")) {
    fail("No skill was installed.");
  }
}

async function runAuth(args: string[]): Promise<void> {
  if (wantsHelp(args)) return printHelp();
  const { positional, values } = parseCommandArgs("auth", args, ["--agent"], [], 1);
  const action = positional[0] ?? "status";
  const agentId = agentOptionFrom(values);
  if (action === "status") {
    const agents = agentId === undefined ? reviewAgents : reviewAgents.filter((agent) => agent.id === agentId);
    for (const agent of agents) {
      const status = await agent.getAuthStatus();
      if (status.state === "signed-in") process.stdout.write(`${agent.name} authentication is ready (${status.accountType}).\n`);
      else if (status.state === "signed-out") process.stdout.write(`${agent.name} is not signed in. Run \`ndrstnd auth login --agent ${agent.id}\`.\n`);
      else process.stdout.write(`${agent.name} authentication could not be checked: ${status.reason}\n`);
    }
    return;
  }
  if (action === "login") {
    const agent = await resolveReviewAgent(agentId).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
    const beforeLogin = await agent.getAuthStatus();
    if (beforeLogin.state === "signed-in") {
      process.stdout.write(`${agent.name} authentication is already ready (${beforeLogin.accountType}).\n`);
      return;
    }
    await runAgentLogin(agent);
    const afterLogin = await agent.getAuthStatus();
    if (afterLogin.state === "signed-in") process.stdout.write(`${agent.name} authentication is ready (${afterLogin.accountType}).\n`);
    else fail(`${agent.name} login completed but ndrstnd could not validate an authenticated connection.`);
    return;
  }
  fail(`Unknown auth action: ${action}`);
}

async function runAgentLogin(agent: ReviewAgent): Promise<void> {
  const child = spawn(agent.command, agent.loginArgs, { stdio: "inherit" });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode ?? 1;
  }
}

async function runReview(args: string[]): Promise<void> {
  if (wantsHelp(args)) return printHelp();
  const { positional, values, flags } = parseCommandArgs("review", args, ["--base", "--repo", "--conversation", "--agent"], ["--uncommitted", "--no-open", "--fresh"], 1);
  const targetArg = positional[0];
  const uncommitted = flags.has("--uncommitted");
  const explicitBase = values.get("--base");
  if (uncommitted && explicitBase !== undefined) fail("--uncommitted already reviews against HEAD; do not combine it with --base.");
  if (uncommitted && targetArg !== undefined) fail("--uncommitted reviews the checked-out branch; do not pass a branch.");
  const noOpen = flags.has("--no-open");
  const repoPath = await canonicalRepoPath(values.get("--repo"));
  const baseRef = uncommitted ? "HEAD" : explicitBase;
  const agent = await resolveReviewAgent(values.get("--agent")).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
  const conversationPath = values.get("--conversation");
  const store = openReviewStore();
  try {
    const conversation = conversationPath === undefined ? undefined : await importConversation(conversationPath);
    await ensureArtifactDirectoryIgnored(repoPath);
    const input = await new GitReader().collectReviewInput(repoPath, targetArg, baseRef);
    const meaningfulFiles = input.files.filter((file) => file.signal === "meaningful").length;
    const scope = await describeReviewScope(repoPath, input);
    process.stdout.write(`Reviewing ${scope.targetLabel} against ${input.baseRef}${input.includesWorkingTree ? ", including uncommitted changes" : ""}: ${input.files.length} changed file${input.files.length === 1 ? "" : "s"} (${meaningfulFiles} meaningful).\n`);
    if (baseRef === undefined && input.includesWorkingTree && scope.localCommitsIncluded > 0) {
      process.stdout.write(`Warning: the inferred base ${input.baseRef} is ${scope.localCommitsIncluded} commit${scope.localCommitsIncluded === 1 ? "" : "s"} behind ${scope.targetLabel}, so those commits are included. Pass --base to narrow the review, or --uncommitted for only uncommitted changes.\n`);
    }
    if (await installedSkillIsStale()) {
      process.stdout.write("The installed ndrstnd skill is older than this version; run `ndrstnd skill install --force` to refresh it.\n");
    }
    const session = store.getOrCreateSession(input, conversation);
    let revision = flags.has("--fresh") ? undefined : selectReusableRevision(store.listRevisions(session.id), agent.id);
    if (revision !== undefined) {
      process.stdout.write(`Reusing the ${agent.name} analysis cached ${formatRevisionAge(revision.createdAt)}; pass --fresh to re-analyze.\n`);
    }
    if (revision === undefined) {
      const auth = await agent.getAuthStatus();
      if (auth.state === "signed-out") throw new Error(`${agent.name} is not signed in, so ndrstnd cannot analyze this change. Run \`ndrstnd auth login --agent ${agent.id}\` first.`);
      if (auth.state === "unreachable") throw new Error(`${agent.name} could not be reached, so ndrstnd cannot analyze this change: ${auth.reason}`);
      process.stdout.write(`Drafting the review narrative with ${agent.name}… This takes minutes on large branches; a heartbeat line prints every 15 seconds while the analysis is alive.\n`);
      const heartbeat = startAnalysisHeartbeat(agent);
      try {
        const document = await analyzeWithAgent(agent, input, conversation, heartbeat.progress);
        revision = store.createRevision(session.id, agent.id, "complete", document);
      } catch (error) {
        throw new Error(`${agent.name} analysis failed, so no review artifact was written: ${error instanceof Error ? error.message : String(error)} Nothing was persisted; re-run the same ndrstnd review command to retry.`);
      } finally {
        heartbeat.stop();
      }
    }
    process.stdout.write(`merge-base=${input.mergeBase.slice(0, 12)} files=${input.files.length} meaningful-files=${meaningfulFiles} hunks=${input.hunks.length}${conversation === undefined ? "" : ` conversation=${conversation.messages.length}`}\n`);
    const artifactPath = await writeReviewArtifact(session, revision, { directory: join(repoPath, ".ndrstnd") });
    process.stdout.write(`ndrstnd artifact: ${artifactPath}\n`);
    process.stdout.write("This self-contained file is in the Git-ignored .ndrstnd directory; delete it when the review is done.\n");
    if (!noOpen) openBrowser(pathToFileURL(artifactPath).href);
  } catch (error) {
    // fail() exits the process immediately, so the store must close first rather than in a finally.
    store.close();
    fail(error instanceof Error ? error.message : String(error));
  }
  store.close();
}

/** Resolving and de-symlinking the repository path keeps session identity independent of how the path was spelled. */
async function canonicalRepoPath(repoArgument: string | undefined): Promise<string> {
  const requested = resolve(repoArgument ?? process.cwd());
  try {
    return await realpath(requested);
  } catch {
    fail(`The repository path ${requested} does not exist.`);
  }
}

function formatRevisionAge(createdAt: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(createdAt)) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Prints liveness lines while the agent analyzes so a caller (human or agent) never mistakes a long turn for a hang. */
function startAnalysisHeartbeat(agent: ReviewAgent): { progress: AnalysisProgress; stop: () => void } {
  // Defined here because the top-level command dispatch runs before module-level consts initialize.
  const HEARTBEAT_INTERVAL_MS = 15_000;
  const startedAt = Date.now();
  let latest: TurnActivity | undefined;
  let lastEventAt = startedAt;
  const timer = setInterval(() => {
    process.stdout.write(`${formatAnalysisHeartbeat(agent.name, Date.now() - startedAt, latest, Date.now() - lastEventAt)}\n`);
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return {
    progress: {
      onActivity: (activity) => {
        latest = activity;
        lastEventAt = Date.now();
      },
      onRepair: (attempt, attempts, problem) => {
        process.stdout.write(`${agent.name}'s draft failed validation; requesting repair turn ${attempt} of ${attempts}: ${problem}\n`);
      },
    },
    stop: () => clearInterval(timer),
  };
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
  const { command, args } = browserOpenCommand(url, process.platform);
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  // A machine without an opener (headless Linux) must not turn a finished review into a crash.
  child.once("error", (error) => {
    process.stdout.write(`Could not open a browser automatically (${error.message}); open the artifact path above manually.\n`);
  });
  child.unref();
}

function printHelp(): void {
  process.stdout.write(`ndrstnd: understand agent-produced branch changes\n\nUsage:\n  ndrstnd auth <status|login> [--agent <codex|claude>]\n  ndrstnd skill install [--force] [--agent <codex|claude>]\n  ndrstnd review [branch] [--base <branch>] [--uncommitted] [--repo <path>] [--conversation <path>] [--agent <codex|claude>] [--fresh] [--no-open]\n  ndrstnd --version\n\nWithout a branch, ndrstnd reviews the checked-out branch including uncommitted changes.\n--uncommitted reviews only the uncommitted working-tree changes (an alias for --base HEAD).\n--agent picks the analysis agent; without it ndrstnd uses NDRSTND_AGENT, then the Codex or Claude Code session it runs inside, then the first installed CLI, preferring Codex.\n--fresh re-analyzes even when a cached analysis exists for the same input.\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
