import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { PiRpcClient, describePiEvent } from "../src/server/pi.js";
import type { TurnActivity } from "../src/server/agent.js";

class FakePiProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }

  emitMessage(message: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

type PiCommand = { id: string; type: string; message?: string };

function stubbedClient(
  client: PiRpcClient,
  onCommand: (child: FakePiProcess, command: PiCommand) => void,
): { child: FakePiProcess; calls: Array<{ cwd: string; args: string[] }>; commands: PiCommand[] } {
  const child = new FakePiProcess();
  const calls: Array<{ cwd: string; args: string[] }> = [];
  const commands: PiCommand[] = [];
  // SAFETY: Tests replace the adapter's process-construction seam with a protocol-compatible fake child.
  (client as unknown as { spawnPi: (cwd: string, args: string[]) => FakePiProcess }).spawnPi = (cwd, args) => {
    calls.push({ cwd, args });
    let input = "";
    child.stdin.on("data", (chunk: Buffer) => {
      input += chunk.toString("utf8");
      for (;;) {
        const newline = input.indexOf("\n");
        if (newline === -1) break;
        // SAFETY: PiRpcClient is the sole writer and the fake only receives its known command JSON shape.
        const command = JSON.parse(input.slice(0, newline)) as PiCommand;
        input = input.slice(newline + 1);
        commands.push(command);
        onCommand(child, command);
      }
    });
    return child;
  };
  return { child, calls, commands };
}

function respond(child: FakePiProcess, command: PiCommand, data?: unknown): void {
  child.emitMessage({ id: command.id, type: "response", command: command.type, success: true, ...(data === undefined ? {} : { data }) });
}

async function startThread(client: PiRpcClient) {
  return client.startTextThread("/repo");
}

describe("PiRpcClient", () => {
  it("uses strict LF framing, preserves split UTF-8 and Unicode separators, and returns the final assistant text", async () => {
    const client = new PiRpcClient();
    const activities: TurnActivity[] = [];
    const { child } = stubbedClient(client, (process, command) => {
      if (command.type === "prompt") {
        respond(process, command);
        const event = Buffer.from(`${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "draft\u2028π" } })}\n${JSON.stringify({ type: "agent_settled" })}\n`);
        const split = event.indexOf(Buffer.from("π")) + 1;
        process.stdout.write(event.subarray(0, split));
        process.stdout.write(event.subarray(split));
      } else if (command.type === "get_last_assistant_text") {
        respond(process, command, { text: "final π" });
      }
    });

    const thread = await startThread(client);
    await expect(thread.send("Explain this branch.", (activity) => activities.push(activity))).resolves.toBe("final π");
    expect(activities.at(-1)).toEqual({ label: "drafting the narrative", notifications: 1, draftCharacters: 7 });
    await thread.close();
    client.close();
    expect(child.killed).toBe(true);
  });

  it("does not treat prompt acceptance as completion and reuses one process for repair turns", async () => {
    const client = new PiRpcClient();
    let settleFirst: (() => void) | undefined;
    const { calls, commands } = stubbedClient(client, (child, command) => {
      if (command.type === "prompt") {
        respond(child, command);
        const turn = commands.filter((candidate) => candidate.type === "prompt").length;
        if (turn === 1) settleFirst = () => child.emitMessage({ type: "agent_settled" });
        else child.emitMessage({ type: "agent_settled" });
      } else if (command.type === "get_last_assistant_text") {
        const turn = commands.filter((candidate) => candidate.type === "prompt").length;
        respond(child, command, { text: turn === 1 ? "first" : "repaired" });
      }
    });

    const thread = await startThread(client);
    let completed = false;
    const first = thread.send("initial").then((text) => {
      completed = true;
      return text;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(completed).toBe(false);
    settleFirst?.();
    await expect(first).resolves.toBe("first");
    await expect(thread.send("repair")).resolves.toBe("repaired");
    expect(calls).toHaveLength(1);
    expect(commands.filter((command) => command.type === "prompt").map((command) => command.message)).toEqual(["initial", "repair"]);
    client.close();
  });

  it("reports signed-out auth for no models and the selected provider/model when models are usable", async () => {
    const signedOut = new PiRpcClient();
    stubbedClient(signedOut, (child, command) => {
      if (command.type === "get_available_models") respond(child, command, { models: [] });
      if (command.type === "get_state") respond(child, command, { model: null });
    });
    await expect(signedOut.getAuthStatus("/repo")).resolves.toEqual({ state: "signed-out" });

    const signedIn = new PiRpcClient();
    stubbedClient(signedIn, (child, command) => {
      if (command.type === "get_available_models") respond(child, command, { models: [{ provider: "anthropic", id: "claude-sonnet" }, { provider: "openai", id: "gpt-5" }] });
      if (command.type === "get_state") respond(child, command, { model: { provider: "anthropic", id: "claude-sonnet" } });
    });
    await expect(signedIn.getAuthStatus("/repo")).resolves.toEqual({ state: "signed-in", accountType: "anthropic/claude-sonnet" });
  });

  it("loads user provider extensions while disabling project resources and exposing only read-only tools", async () => {
    const client = new PiRpcClient();
    const { calls } = stubbedClient(client, (child, command) => {
      if (command.type === "prompt") {
        respond(child, command);
        child.emitMessage({ type: "agent_settled" });
      } else if (command.type === "get_last_assistant_text") respond(child, command, { text: "ok" });
    });

    const thread = await startThread(client);
    await thread.send("review");
    expect(calls).toEqual([{ cwd: "/repo", args: [
      "--mode", "rpc", "--no-session", "--no-approve", "--no-skills",
      "--no-prompt-templates", "--no-context-files", "--tools", "read,grep,find,ls",
    ] }]);
    expect(calls[0].args).not.toContain("--no-extensions");
    expect(calls[0].args).not.toContain("bash");
    client.close();
  });

  it("surfaces provider failures after retries settle", async () => {
    const client = new PiRpcClient();
    stubbedClient(client, (child, command) => {
      if (command.type !== "prompt") return;
      respond(child, command);
      child.emitMessage({ type: "message_update", assistantMessageEvent: { type: "error", error: { errorMessage: "quota exhausted" } } });
      child.emitMessage({ type: "agent_settled" });
    });

    const thread = await startThread(client);
    await expect(thread.send("review")).rejects.toThrow("Pi analysis failed: quota exhausted");
    client.close();
  });

  it("surfaces failed commands and missing final assistant text", async () => {
    const failed = new PiRpcClient();
    stubbedClient(failed, (child, command) => {
      child.emitMessage({ id: command.id, type: "response", command: command.type, success: false, error: "model unavailable" });
    });
    const failedThread = await startThread(failed);
    await expect(failedThread.send("review")).rejects.toThrow("Pi RPC prompt failed: model unavailable");
    failed.close();

    const missing = new PiRpcClient();
    stubbedClient(missing, (child, command) => {
      if (command.type === "prompt") {
        respond(child, command);
        child.emitMessage({ type: "agent_settled" });
      } else if (command.type === "get_last_assistant_text") respond(child, command, { text: null });
    });
    const missingThread = await startThread(missing);
    await expect(missingThread.send("review")).rejects.toThrow("Pi RPC returned no final assistant text");
    missing.close();
  });

  it("reports spawn, exit, broken-input, request-timeout, and inactivity failures", async () => {
    const spawnFailure = new PiRpcClient();
    const spawned = stubbedClient(spawnFailure, () => undefined);
    const spawnThread = await startThread(spawnFailure);
    const spawnTurn = spawnThread.send("review");
    queueMicrotask(() => spawned.child.emit("error", new Error("spawn pi ENOENT")));
    await expect(spawnTurn).rejects.toThrow("Pi RPC could not run: spawn pi ENOENT");

    const exitFailure = new PiRpcClient();
    const exited = stubbedClient(exitFailure, () => undefined);
    const exitThread = await startThread(exitFailure);
    const exitTurn = exitThread.send("review");
    queueMicrotask(() => exited.child.emit("exit", 2));
    await expect(exitTurn).rejects.toThrow("Pi RPC exited with status 2");

    const inputFailure = new PiRpcClient();
    const broken = stubbedClient(inputFailure, () => undefined);
    const inputThread = await startThread(inputFailure);
    const inputTurn = inputThread.send("review");
    queueMicrotask(() => broken.child.stdin.emit("error", new Error("write EPIPE")));
    await expect(inputTurn).rejects.toThrow("Pi RPC stopped accepting input: write EPIPE");

    const requestTimeout = new PiRpcClient(300_000, 20);
    stubbedClient(requestTimeout, () => undefined);
    const timeoutThread = await startThread(requestTimeout);
    await expect(timeoutThread.send("review")).rejects.toThrow(/Pi RPC did not answer prompt within 0s/);
    requestTimeout.close();

    const inactivity = new PiRpcClient(20);
    const stalled = stubbedClient(inactivity, (child, command) => {
      if (command.type === "prompt") {
        respond(child, command);
        child.emitMessage({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial" } });
        child.stderr.write("429 too many requests");
      }
    });
    const inactivityThread = await startThread(inactivity);
    await expect(inactivityThread.send("review")).rejects.toThrow(/Pi analysis stalled: no RPC activity for 0s after 1 events and 7 draft characters\. Pi reported: 429 too many requests/);
    stalled.child.emit("exit", 1);
  });
});

describe("describePiEvent", () => {
  it("labels drafting, tools, and retry activity", () => {
    expect(describePiEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } })).toBe("drafting the narrative");
    expect(describePiEvent({ type: "tool_execution_start", toolName: "read", args: { path: "src/app.ts" } })).toBe("reading src/app.ts");
    expect(describePiEvent({ type: "tool_execution_start", toolName: "grep", args: { pattern: "ReviewAgent" } })).toBe("searching the repository for `ReviewAgent`");
    expect(describePiEvent({ type: "auto_retry_start", attempt: 2, maxAttempts: 3 })).toBe("retrying the provider request (2 of 3)");
    expect(describePiEvent({ type: "agent_start" })).toBeUndefined();
  });
});
