import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { AgentClient, AgentTextThread, AuthStatus, TurnActivity } from "./agent.js";

const PI_RPC_ARGS = [
  "--mode", "rpc",
  "--no-session",
  "--no-approve",
  "--no-skills",
  "--no-prompt-templates",
  "--no-context-files",
  "--tools", "read,grep,find,ls",
] as const;

/** Turns a Pi RPC event into reviewer-facing phrasing; undefined means the previous label still applies. */
export function describePiEvent(event: Record<string, unknown>): string | undefined {
  const type = event["type"];
  if (type === "message_update" && asObject(event["assistantMessageEvent"])["type"] === "text_delta") return "drafting the narrative";
  if (type === "tool_execution_start") {
    const toolName = typeof event["toolName"] === "string" ? event["toolName"] : "";
    const args = asObject(event["args"]);
    if (toolName === "read") {
      const path = firstString(args, ["path", "file_path"]);
      return path === undefined ? "reading repository files" : `reading ${compactText(path)}`;
    }
    if (toolName === "grep") {
      const pattern = firstString(args, ["pattern", "query"]);
      return pattern === undefined ? "searching the repository" : `searching the repository for \`${compactText(pattern)}\``;
    }
    if (toolName === "find") return "finding repository files";
    if (toolName === "ls") return "listing repository files";
    return toolName === "" ? "inspecting the repository" : `using ${toolName}`;
  }
  if (type === "auto_retry_start") {
    const attempt = typeof event["attempt"] === "number" ? event["attempt"] : undefined;
    const maxAttempts = typeof event["maxAttempts"] === "number" ? event["maxAttempts"] : undefined;
    return attempt === undefined || maxAttempts === undefined ? "retrying the provider request" : `retrying the provider request (${attempt} of ${maxAttempts})`;
  }
  if (type === "auto_retry_end" && event["success"] === true) return "provider retry completed";
  return undefined;
}

/** Checks whether Pi has at least one usable model and reports the selected provider/model. */
export async function getPiAuthStatus(): Promise<AuthStatus> {
  return new PiRpcClient().getAuthStatus(process.cwd());
}

/**
 * Runs analysis through one ephemeral Pi RPC process, preserving its in-memory
 * conversation across validation-repair turns while exposing only read tools.
 * User extensions remain enabled because they may register the authenticated
 * provider; `--no-approve` prevents project extensions from loading.
 */
export class PiRpcClient implements AgentClient {
  private process: ChildProcessWithoutNullStreams | undefined;
  private cwd: string | undefined;
  private decoder = new StringDecoder("utf8");
  private buffer = "";
  private stderrTail = "";
  private nextId = 1;
  private failure: Error | undefined;
  private closed = false;
  private turnActive = false;
  private readonly pending = new Map<string, { command: string; timeout: NodeJS.Timeout; resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private readonly eventListeners = new Set<(event: Record<string, unknown>) => void>();
  private readonly failureListeners = new Set<(error: Error) => void>();

  /** Creates a Pi client with inactivity and command-response timeouts. */
  constructor(private readonly inactivityTimeoutMs = 300_000, private readonly requestTimeoutMs = 60_000) {}

  /** Starts one reusable text thread rooted at the reviewed repository. */
  async startTextThread(cwd: string): Promise<AgentTextThread> {
    await this.start(cwd);
    return {
      send: (prompt, onActivity) => this.runTurn(prompt, onActivity),
      close: async () => undefined,
    };
  }

  /** Checks auth through this client; primarily useful to keep process lifecycle and parsing in one adapter. */
  async getAuthStatus(cwd = process.cwd()): Promise<AuthStatus> {
    try {
      await this.start(cwd);
      const [modelsResponse, stateResponse] = await Promise.all([
        this.request("get_available_models"),
        this.request("get_state"),
      ]);
      const models = asArray(asObject(modelsResponse["data"])["models"]);
      if (models.length === 0) return { state: "signed-out" };
      const selected = asObject(asObject(stateResponse["data"])["model"]);
      const fallback = asObject(models[0]);
      const provider = firstString(selected, ["provider"]) ?? firstString(fallback, ["provider"]) ?? "unknown";
      const model = firstString(selected, ["id"]) ?? firstString(fallback, ["id"]) ?? "unknown";
      return { state: "signed-in", accountType: `${provider}/${model}` };
    } catch (error) {
      return { state: "unreachable", reason: error instanceof Error ? error.message : String(error) };
    } finally {
      this.close();
    }
  }

  /** Aborts any active run, terminates Pi, and rejects outstanding work. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const child = this.process;
    if (child !== undefined && this.turnActive && child.stdin.writable && !child.stdin.destroyed) {
      child.stdin.write(`${JSON.stringify({ type: "abort" })}\n`);
    }
    this.fail(new Error("Pi RPC closed."));
    child?.kill();
    this.process = undefined;
  }

  private async runTurn(prompt: string, onActivity?: (activity: TurnActivity) => void): Promise<string> {
    if (this.turnActive) throw new Error("Pi RPC already has an active analysis turn.");
    this.turnActive = true;
    let events = 0;
    let draft = "";
    let providerFailure: string | undefined;
    let cancel: ((error: Error) => void) | undefined;

    const settled = new Promise<void>((resolve, reject) => {
      let timeout: NodeJS.Timeout;
      let label = "starting the analysis turn";
      const cleanup = () => {
        clearTimeout(timeout);
        this.eventListeners.delete(listener);
        this.failureListeners.delete(failureListener);
      };
      const failWith = (error: Error) => {
        cleanup();
        reject(error);
      };
      const armTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => failWith(new Error(`Pi analysis stalled: no RPC activity for ${Math.round(this.inactivityTimeoutMs / 1_000)}s after ${events} events and ${draft.length} draft characters.${this.stderrHint()}`)), this.inactivityTimeoutMs);
      };
      const failureListener = (error: Error) => failWith(error);
      const listener = (event: Record<string, unknown>) => {
        events += 1;
        armTimeout();
        const type = event["type"];
        if (type === "message_update") {
          const update = asObject(event["assistantMessageEvent"]);
          if (update["type"] === "text_delta" && typeof update["delta"] === "string") draft += update["delta"];
          if (update["type"] === "error") providerFailure = providerError(update);
          if (update["type"] === "done") providerFailure = undefined;
        }
        if (type === "agent_end") providerFailure = agentEndFailure(event) ?? providerFailure;
        if (type === "auto_retry_end" && event["success"] === true) providerFailure = undefined;
        if (type === "auto_retry_end" && event["success"] === false) {
          providerFailure = typeof event["finalError"] === "string" && event["finalError"] !== "" ? event["finalError"] : providerFailure;
        }
        if (type === "agent_settled") {
          cleanup();
          if (providerFailure === undefined) resolve();
          else reject(new Error(`Pi analysis failed: ${providerFailure}${this.stderrHint()}`));
          return;
        }
        label = describePiEvent(event) ?? label;
        onActivity?.({ label, notifications: events, draftCharacters: draft.length });
      };
      armTimeout();
      this.eventListeners.add(listener);
      this.failureListeners.add(failureListener);
      cancel = failWith;
    });
    settled.catch(() => undefined);

    try {
      try {
        await this.request("prompt", { message: prompt });
      } catch (error) {
        const requestError = error instanceof Error ? error : new Error(String(error));
        cancel?.(requestError);
        throw requestError;
      }
      await settled;
      const response = await this.request("get_last_assistant_text");
      const text = asObject(response["data"])["text"];
      if (typeof text !== "string" || text === "") throw new Error(`Pi RPC returned no final assistant text.${this.stderrHint()}`);
      return text;
    } finally {
      this.turnActive = false;
    }
  }

  private async start(cwd: string): Promise<void> {
    if (this.closed) throw new Error("Pi RPC is not running.");
    if (this.process !== undefined) {
      if (this.cwd !== cwd) throw new Error(`Pi RPC is already rooted at ${this.cwd ?? "another repository"}.`);
      return;
    }
    this.failure = undefined;
    this.cwd = cwd;
    this.decoder = new StringDecoder("utf8");
    this.buffer = "";
    this.stderrTail = "";
    const child = this.spawnPi(cwd, [...PI_RPC_ARGS]);
    this.process = child;
    child.stdout.on("data", (chunk: Buffer | string) => this.handleOutput(chunk));
    child.stdout.on("end", () => this.finishOutput());
    child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderrTail = `${this.stderrTail}${typeof chunk === "string" ? chunk : chunk.toString("utf8")}`.slice(-4_000);
    });
    child.stdin.on("error", (error: Error) => this.fail(new Error(`Pi RPC stopped accepting input: ${error.message}${this.stderrHint()}`)));
    child.once("error", (error) => this.fail(new Error(`Pi RPC could not run: ${error.message}${this.stderrHint()}`)));
    child.once("exit", (code) => {
      if (!this.closed && this.process === child) this.fail(new Error(`Pi RPC exited with status ${code ?? "unknown"}.${this.stderrHint()}`));
    });
  }

  /** Kept as an instance method so tests can substitute a scripted child process. */
  private spawnPi(cwd: string, args: string[]): ChildProcessWithoutNullStreams {
    return spawn("pi", args, { cwd, stdio: "pipe" });
  }

  private request(command: string, fields: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const child = this.process;
    if (child === undefined) return Promise.reject(new Error("Pi RPC is not running."));
    if (this.failure !== undefined) return Promise.reject(this.failure);
    const id = `ndrstnd-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC did not answer ${command} within ${Math.round(this.requestTimeoutMs / 1_000)}s.${this.stderrHint()}`));
      }, this.requestTimeoutMs);
      timeout.unref();
      this.pending.set(id, { command, timeout, resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, type: command, ...fields })}\n`);
    });
  }

  private handleOutput(chunk: Buffer | string): void {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return;
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.handleLine(line);
    }
  }

  private finishOutput(): void {
    this.buffer += this.decoder.end();
    if (this.buffer !== "") this.handleLine(this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer);
    this.buffer = "";
  }

  private handleLine(line: string): void {
    if (line === "") return;
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
      // SAFETY: The runtime object check above establishes the indexable record shape used by this protocol adapter.
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    if (message["type"] === "response" && typeof message["id"] === "string") {
      const pending = this.pending.get(message["id"]);
      if (pending === undefined) return;
      this.pending.delete(message["id"]);
      clearTimeout(pending.timeout);
      if (message["success"] !== true) {
        const reason = typeof message["error"] === "string" && message["error"] !== "" ? message["error"] : "Pi reported no reason";
        pending.reject(new Error(`Pi RPC ${pending.command} failed: ${reason}.${this.stderrHint()}`));
      } else pending.resolve(message);
      return;
    }
    for (const listener of [...this.eventListeners]) listener(message);
  }

  private fail(error: Error): void {
    if (this.failure !== undefined && error.message !== "Pi RPC closed.") return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of [...this.failureListeners]) listener(error);
  }

  private stderrHint(): string {
    const tail = this.stderrTail.trim().slice(-600);
    return tail === "" ? "" : ` Pi reported: ${tail}`;
  }
}

function providerError(update: Record<string, unknown>): string {
  const error = asObject(update["error"]);
  return firstString(error, ["errorMessage"]) ?? firstString(asObject(error["error"]), ["message"]) ?? "the provider reported no reason";
}

function agentEndFailure(event: Record<string, unknown>): string | undefined {
  for (const value of asArray(event["messages"]).toReversed()) {
    const message = asObject(value);
    if (message["role"] !== "assistant" || message["stopReason"] !== "error") continue;
    return firstString(message, ["errorMessage"]) ?? "the provider reported no reason";
  }
  return undefined;
}

function firstString(object: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

function compactText(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 90 ? `${collapsed.slice(0, 87)}…` : collapsed;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  // SAFETY: The runtime checks establish a non-null, non-array object; only unknown property reads cross this adapter boundary.
  return value as Record<string, unknown>;
}
