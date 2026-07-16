import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { CodexAppServerClient, getCodexAuthStatus } from "./codex.js";
import { ClaudeCodeClient, getClaudeAuthStatus } from "./claude.js";
import { PiRpcClient, getPiAuthStatus } from "./pi.js";

export type AuthStatus =
  | { state: "signed-in"; accountType: string }
  | { state: "signed-out" }
  | { state: "unreachable"; reason: string };

/** A liveness snapshot of a running turn, emitted on every agent event so callers can print heartbeats. */
export interface TurnActivity {
  label: string;
  notifications: number;
  draftCharacters: number;
}

export interface AgentTextThread {
  send(prompt: string, onActivity?: (activity: TurnActivity) => void): Promise<string>;
  close(): Promise<void>;
}

export interface AgentClient {
  startTextThread(cwd: string): Promise<AgentTextThread>;
  close(): void;
}

/** Stable identifier accepted by CLI, persistence, and presentation boundaries for a review agent. */
export type ReviewAgentId = "codex" | "claude" | "pi";

export interface ReviewAgent {
  id: ReviewAgentId;
  /** Human-readable name used in CLI output, error messages, and artifacts. */
  name: string;
  /** Executable probed on PATH when no agent is requested explicitly. */
  command: string;
  /** Arguments after the command that start the interactive sign-in flow. */
  loginArgs: string[];
  /** Instructions printed before an agent-specific interactive sign-in flow. */
  loginInstructions?: string;
  /** The agent's configuration directory, whose skills/ subdirectory receives the ndrstnd skill. */
  homeDirectory(): string;
  createClient(): AgentClient;
  getAuthStatus(): Promise<AuthStatus>;
}

export const codexAgent: ReviewAgent = {
  id: "codex",
  name: "Codex",
  command: "codex",
  loginArgs: ["login"],
  homeDirectory: () => process.env.CODEX_HOME ?? join(homedir(), ".codex"),
  createClient: () => new CodexAppServerClient(),
  getAuthStatus: getCodexAuthStatus,
};

export const claudeAgent: ReviewAgent = {
  id: "claude",
  name: "Claude Code",
  command: "claude",
  loginArgs: ["auth", "login"],
  homeDirectory: () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
  createClient: () => new ClaudeCodeClient(),
  getAuthStatus: getClaudeAuthStatus,
};

/** Pi agent configuration backed by one ephemeral RPC session per analysis attempt. */
export const piAgent: ReviewAgent = {
  id: "pi",
  name: "Pi",
  command: "pi",
  loginArgs: [],
  loginInstructions: "Pi will open. Run /login, configure a provider, then run /quit.",
  homeDirectory: () => process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
  createClient: () => new PiRpcClient(),
  getAuthStatus: getPiAuthStatus,
};

/** Codex stays first: it was ndrstnd's original agent, so it remains the default when multiple CLIs are installed. */
export const reviewAgents: readonly ReviewAgent[] = [codexAgent, claudeAgent, piAgent];

export function reviewAgentById(id: string): ReviewAgent | undefined {
  return reviewAgents.find((agent) => agent.id === id);
}

/**
 * The agent whose session this process was launched from, if any. Each CLI marks
 * the shell commands it runs: Pi sets PI_CODING_AGENT, Claude Code sets
 * CLAUDECODE, and Codex sets CODEX_SANDBOX for sandboxed commands. Pi wins
 * because its marker names the innermost Pi process even when outer markers remain.
 */
export function hostAgent(env: NodeJS.ProcessEnv = process.env): ReviewAgent | undefined {
  if (env["PI_CODING_AGENT"] !== undefined && env["PI_CODING_AGENT"] !== "") return piAgent;
  if (env["CLAUDECODE"] !== undefined && env["CLAUDECODE"] !== "") return claudeAgent;
  if (env["CODEX_SANDBOX"] !== undefined && env["CODEX_SANDBOX"] !== "") return codexAgent;
  return undefined;
}

/** Resolves --agent, then NDRSTND_AGENT, then the agent hosting this process, then the first supported agent whose CLI is installed. */
export async function resolveReviewAgent(requested: string | undefined = process.env.NDRSTND_AGENT): Promise<ReviewAgent> {
  if (requested !== undefined && requested !== "") {
    const agent = reviewAgentById(requested);
    if (agent === undefined) throw new Error(`Unknown analysis agent: ${requested}. Supported agents: ${reviewAgents.map((candidate) => candidate.id).join(", ")}.`);
    return agent;
  }
  const host = hostAgent();
  if (host !== undefined) return host;
  for (const agent of reviewAgents) {
    if (await commandIsInstalled(agent.command)) return agent;
  }
  return codexAgent;
}

async function commandIsInstalled(command: string): Promise<boolean> {
  const extensions = process.platform === "win32" ? ["", ".cmd", ".exe", ".bat"] : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory === "") continue;
    for (const extension of extensions) {
      try {
        await access(join(directory, command + extension), constants.X_OK);
        return true;
      } catch {
        // Keep probing the remaining PATH entries.
      }
    }
  }
  return false;
}
