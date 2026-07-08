import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentClient, AgentTextThread, AuthStatus, TurnActivity } from "./agent.js";

export type { TurnActivity } from "./agent.js";

/** Turns a thread notification into reviewer-facing phrasing; undefined means the previous label still applies. */
export function describeThreadNotification(method: string, params: Record<string, unknown>): string | undefined {
  if (method === "item/agentMessage/delta") return "drafting the narrative";
  const item = asObject(params["item"]);
  const itemType = item["type"];
  if (itemType === "commandExecution") {
    const command = typeof item["command"] === "string" ? item["command"].replace(/\s+/g, " ").trim() : "";
    if (command === "") return "inspecting the repository";
    const compact = command.length > 90 ? `${command.slice(0, 87)}…` : command;
    return method === "item/completed" ? `finished \`${compact}\`` : `running \`${compact}\``;
  }
  if (itemType === "reasoning") return "reasoning about the branch";
  if (itemType === "agentMessage") return "drafting the narrative";
  if (itemType === "webSearch") return "searching the web";
  return undefined;
}

export async function getCodexAuthStatus(): Promise<AuthStatus> {
  const client = new CodexAppServerClient();
  try {
    const response = await client.request("account/read", { refreshToken: false });
    const account = asObject(response)["account"];
    if (account === null || account === undefined) return { state: "signed-out" };
    const accountType = typeof asObject(account)["type"] === "string" ? String(asObject(account)["type"]) : "unknown";
    return { state: "signed-in", accountType };
  } catch (error) {
    return { state: "unreachable", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    client.close();
  }
}

export class CodexAppServerClient implements AgentClient {
  private process: ChildProcessWithoutNullStreams | undefined;
  private buffer = "";
  private stderrTail = "";
  private initialized = false;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
  private readonly notificationListeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  private readonly failureListeners = new Set<(error: Error) => void>();

  constructor(private readonly inactivityTimeoutMs = 300_000) {}

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.start();
    if (!this.initialized) {
      await this.sendRequest("initialize", {
        clientInfo: { name: "ndrstnd", title: "ndrstnd", version: "0.1.0" },
      });
      this.sendNotification("initialized", {});
      this.initialized = true;
    }
    return this.sendRequest(method, params);
  }

  close(): void {
    this.rejectPending(new Error("Codex app-server closed."));
    this.process?.kill();
    this.process = undefined;
    this.initialized = false;
  }

  async runTextTurn(cwd: string, prompt: string, onActivity?: (activity: TurnActivity) => void): Promise<string> {
    const thread = await this.startTextThread(cwd);
    try {
      return await thread.send(prompt, onActivity);
    } finally {
      await thread.close();
    }
  }

  /** Starts a reusable thread so follow-up turns (validation repairs) keep the inspection context instead of resending the full prompt. */
  async startTextThread(cwd: string): Promise<AgentTextThread> {
    const threadResponse = asObject(await this.request("thread/start", { cwd, sandbox: "read-only", approvalPolicy: "never" }));
    const threadId = String(asObject(threadResponse["thread"])["id"] ?? "");
    if (threadId === "") throw new Error("Codex app-server did not return an analysis thread ID.");
    return {
      send: (prompt, onActivity) => this.runThreadTurn(threadId, cwd, prompt, onActivity),
      close: async () => {
        await this.request("thread/archive", { threadId }).catch(() => undefined);
      },
    };
  }

  private async runThreadTurn(threadId: string, cwd: string, prompt: string, onActivity?: (activity: TurnActivity) => void): Promise<string> {
    let text = "";
    const completed = new Promise<void>((resolve, reject) => {
      // Inspecting a large branch takes many quiet-but-active tool turns, so time
      // out on inactivity across any thread notification rather than total duration.
      let timeout: NodeJS.Timeout;
      let notifications = 0;
      let label = "starting the analysis turn";
      const cleanup = () => {
        clearTimeout(timeout);
        this.notificationListeners.delete(listener);
        this.failureListeners.delete(failureListener);
      };
      const failWith = (error: Error) => {
        cleanup();
        reject(error);
      };
      const armTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => failWith(new Error(`Codex analysis stalled: no app-server activity for ${Math.round(this.inactivityTimeoutMs / 1_000)}s after ${notifications} thread notifications and ${text.length} draft characters.${this.stderrHint()}`)), this.inactivityTimeoutMs);
      };
      const failureListener = (error: Error) => failWith(error);
      const listener = (method: string, params: Record<string, unknown>) => {
        if (params["threadId"] !== threadId) return;
        notifications += 1;
        armTimeout();
        if (method === "item/agentMessage/delta") {
          const delta = typeof params["delta"] === "string" ? params["delta"] : "";
          text += delta;
        }
        if (method === "turn/failed") {
          const reason = asObject(params["error"])["message"];
          failWith(new Error(`Codex analysis turn failed: ${typeof reason === "string" && reason !== "" ? reason : "the app-server reported no reason"}.${this.stderrHint()}`));
          return;
        }
        if (method === "turn/completed") {
          cleanup();
          resolve();
          return;
        }
        label = describeThreadNotification(method, params) ?? label;
        onActivity?.({ label, notifications, draftCharacters: text.length });
      };
      armTimeout();
      this.notificationListeners.add(listener);
      this.failureListeners.add(failureListener);
    });

    await this.request("turn/start", { threadId, cwd, approvalPolicy: "never", input: [{ type: "text", text: prompt }] });
    await completed;
    return text;
  }

  private async start(): Promise<void> {
    if (this.process !== undefined) return;
    const process = spawn("codex", ["app-server"], { stdio: "pipe" });
    this.process = process;
    process.stdout.on("data", (chunk: Buffer) => this.handleOutput(chunk.toString("utf8")));
    process.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-4_000);
    });
    process.once("error", (error) => this.fail(new Error(`Codex app-server could not run: ${error.message}${this.stderrHint()}`)));
    process.once("exit", (code) => this.fail(new Error(`Codex app-server exited with status ${code ?? "unknown"}.${this.stderrHint()}`)));
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    this.write({ method, params });
  }

  private write(message: unknown): void {
    if (this.process === undefined) throw new Error("Codex app-server is not running.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleOutput(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line === "") continue;
      let message: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue;
      }
      if (message.id === undefined) {
        if (message.method !== undefined && message.params !== undefined) {
          for (const listener of this.notificationListeners) listener(message.method, message.params);
        }
        continue;
      }
      const pending = this.pending.get(message.id);
      if (pending === undefined) continue;
      this.pending.delete(message.id);
      if (message.error !== undefined) pending.reject(new Error(message.error.message ?? "Codex app-server returned an error."));
      else pending.resolve(message.result);
    }
  }

  private fail(error: Error): void {
    this.rejectPending(error);
    for (const listener of [...this.failureListeners]) listener(error);
  }

  private stderrHint(): string {
    const tail = this.stderrTail.trim().slice(-600);
    return tail === "" ? "" : ` Codex app-server reported: ${tail}`;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
