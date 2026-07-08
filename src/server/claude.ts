import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentClient, AgentTextThread, AuthStatus, TurnActivity } from "./agent.js";

/** Turns a stream-json event into reviewer-facing phrasing; undefined means the previous label still applies. */
export function describeClaudeEvent(event: Record<string, unknown>): string | undefined {
  if (event["type"] === "stream_event") {
    const streamEvent = asObject(event["event"]);
    return streamEvent["type"] === "content_block_delta" && asObject(streamEvent["delta"])["type"] === "text_delta" ? "drafting the narrative" : undefined;
  }
  if (event["type"] !== "assistant") return undefined;
  const content = asObject(event["message"])["content"];
  const block = asObject(Array.isArray(content) ? content.at(-1) : undefined);
  if (block["type"] === "text") return "drafting the narrative";
  if (block["type"] !== "tool_use") return undefined;
  const name = typeof block["name"] === "string" ? block["name"] : "";
  const input = asObject(block["input"]);
  if (name === "Bash" && typeof input["command"] === "string" && input["command"].trim() !== "") return `running \`${compactText(input["command"])}\``;
  if (name === "Read" && typeof input["file_path"] === "string") return `reading ${compactText(input["file_path"])}`;
  if (name === "Grep" || name === "Glob") return "searching the repository";
  return name === "" ? "inspecting the repository" : `using ${name}`;
}

function compactText(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 90 ? `${collapsed.slice(0, 87)}…` : collapsed;
}

export async function getClaudeAuthStatus(): Promise<AuthStatus> {
  try {
    const { stdout, stderr, exitCode } = await runClaudeCommand(["auth", "status", "--json"]);
    const payload = parseJsonObject(stdout);
    if (payload === undefined) {
      throw new Error(exitCode === 0 ? "Claude Code returned an unreadable auth status." : `claude auth status exited with status ${exitCode}.${stderrHint(stderr)}`);
    }
    if (payload["loggedIn"] !== true) return { state: "signed-out" };
    const accountType = [payload["subscriptionType"], payload["authMethod"]].find((value) => typeof value === "string" && value !== "");
    return { state: "signed-in", accountType: typeof accountType === "string" ? accountType : "unknown" };
  } catch (error) {
    return { state: "unreachable", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Runs analysis turns through `claude --print`. Each turn is one short-lived
 * process; follow-up turns (validation repairs) resume the same Claude Code
 * session by ID so the inspection context is kept without resending the prompt.
 */
export class ClaudeCodeClient implements AgentClient {
  private closed = false;
  private readonly active = new Set<ChildProcessWithoutNullStreams>();

  constructor(private readonly inactivityTimeoutMs = 300_000) {}

  async startTextThread(cwd: string): Promise<AgentTextThread> {
    let sessionId: string | undefined;
    return {
      send: async (prompt, onActivity) => {
        const turn = await this.runPrintTurn(cwd, prompt, sessionId, onActivity);
        sessionId = turn.sessionId ?? sessionId;
        return turn.text;
      },
      // Print-mode turns end with their process; there is no server-side thread to archive.
      close: async () => undefined,
    };
  }

  close(): void {
    this.closed = true;
    for (const child of this.active) child.kill();
    this.active.clear();
  }

  private runPrintTurn(cwd: string, prompt: string, resumeSessionId: string | undefined, onActivity?: (activity: TurnActivity) => void): Promise<{ text: string; sessionId?: string }> {
    if (this.closed) return Promise.reject(new Error("Claude Code client is not running."));
    const args = [
      "--print",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      // The analysis inspects the repository and must never edit it, run
      // non-git commands, or reach configured MCP servers.
      "--permission-mode", "dontAsk",
      "--tools", "Read,Grep,Glob,Bash",
      "--allowed-tools", "Read,Grep,Glob,Bash(git *)",
      "--strict-mcp-config",
    ];
    if (resumeSessionId !== undefined) args.push("--resume", resumeSessionId);
    const child = this.spawnClaude(cwd, args);
    this.active.add(child);

    let stdoutBuffer = "";
    let stderrTail = "";
    let draft = "";
    let events = 0;
    let sessionId: string | undefined;
    let result: { text: string; isError: boolean; detail: string } | undefined;

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: NodeJS.Timeout;
      const settle = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.active.delete(child);
        child.kill();
        outcome();
      };
      const failWith = (error: Error) => settle(() => reject(error));
      const armTimeout = () => {
        // Inspecting a large branch takes many quiet-but-active tool turns, so
        // time out on inactivity across any stream event rather than total duration.
        clearTimeout(timeout);
        timeout = setTimeout(() => failWith(new Error(`Claude Code analysis stalled: no CLI activity for ${Math.round(this.inactivityTimeoutMs / 1_000)}s after ${events} stream events and ${draft.length} draft characters.${stderrHint(stderrTail)}`)), this.inactivityTimeoutMs);
      };
      let label = "starting the analysis turn";
      const handleEvent = (event: Record<string, unknown>) => {
        events += 1;
        armTimeout();
        if (typeof event["session_id"] === "string" && sessionId === undefined) sessionId = event["session_id"];
        if (event["type"] === "stream_event") {
          const streamEvent = asObject(event["event"]);
          const delta = asObject(streamEvent["delta"]);
          if (streamEvent["type"] === "content_block_delta" && delta["type"] === "text_delta" && typeof delta["text"] === "string") {
            draft += delta["text"];
          }
        }
        if (event["type"] === "result") {
          const denials = Array.isArray(event["permission_denials"]) ? event["permission_denials"].length : 0;
          result = {
            text: typeof event["result"] === "string" ? event["result"] : "",
            isError: event["is_error"] === true,
            detail: `${typeof event["subtype"] === "string" ? event["subtype"] : "an unreported failure"}${denials > 0 ? ` after ${denials} denied tool request${denials === 1 ? "" : "s"}` : ""}`,
          };
          return;
        }
        label = describeClaudeEvent(event) ?? label;
        onActivity?.({ label, notifications: events, draftCharacters: draft.length });
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        for (;;) {
          const newline = stdoutBuffer.indexOf("\n");
          if (newline === -1) return;
          const line = stdoutBuffer.slice(0, newline).trim();
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          if (line === "") continue;
          try {
            handleEvent(JSON.parse(line) as Record<string, unknown>);
          } catch {
            // Ignore non-JSON noise on stdout.
          }
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-4_000);
      });
      child.once("error", (error) => failWith(new Error(`Claude Code could not run: ${error.message}${stderrHint(stderrTail)}`)));
      child.once("close", (code) => {
        const outcome = result;
        if (outcome !== undefined && outcome.isError) return failWith(new Error(`Claude Code analysis turn failed: ${outcome.text !== "" ? outcome.text : outcome.detail}.${stderrHint(stderrTail)}`));
        if (outcome === undefined) return failWith(new Error(`Claude Code exited with status ${code ?? "unknown"} before reporting a result.${stderrHint(stderrTail)}`));
        settle(() => resolve({ text: outcome.text !== "" ? outcome.text : draft, sessionId }));
      });
      armTimeout();
      child.stdin.end(prompt);
    });
  }

  /** Kept as an instance method so tests can substitute a scripted child process. */
  private spawnClaude(cwd: string, args: string[]): ChildProcessWithoutNullStreams {
    return spawn("claude", args, { cwd, stdio: "pipe" });
  }
}

function runClaudeCommand(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000);
    });
    child.once("error", (error) => reject(new Error(`Claude Code could not run: ${error.message}`)));
    child.once("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
  });
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function stderrHint(tail: string): string {
  const trimmed = tail.trim().slice(-600);
  return trimmed === "" ? "" : ` Claude Code reported: ${trimmed}`;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
