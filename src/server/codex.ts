import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type AuthStatus =
  | { state: "signed-in"; accountType: string }
  | { state: "signed-out" }
  | { state: "unreachable"; reason: string };

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

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | undefined;
  private buffer = "";
  private initialized = false;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
  private readonly notificationListeners = new Set<(method: string, params: Record<string, unknown>) => void>();

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

  async runTextTurn(cwd: string, prompt: string, onDelta?: (delta: string) => void): Promise<string> {
    const threadResponse = asObject(await this.request("thread/start", { cwd, sandbox: "read-only", approvalPolicy: "never" }));
    const threadId = String(asObject(threadResponse["thread"])["id"] ?? "");
    if (threadId === "") throw new Error("Codex app-server did not return an analysis thread ID.");

    let text = "";
    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        removeListener();
        reject(new Error("Codex analysis timed out."));
      }, 120_000);
      const listener = (method: string, params: Record<string, unknown>) => {
        if (params["threadId"] !== threadId) return;
        if (method === "item/agentMessage/delta") {
          const delta = typeof params["delta"] === "string" ? params["delta"] : "";
          text += delta;
          onDelta?.(delta);
        }
        if (method === "turn/completed") {
          clearTimeout(timeout);
          removeListener();
          resolve();
        }
      };
      const removeListener = () => this.notificationListeners.delete(listener);
      this.notificationListeners.add(listener);
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
    process.stderr.on("data", () => undefined);
    process.once("error", (error) => this.rejectPending(error));
    process.once("exit", (code) => this.rejectPending(new Error(`Codex app-server exited with status ${code ?? "unknown"}.`)));
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

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
