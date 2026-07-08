import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ClaudeCodeClient, describeClaudeEvent, getClaudeAuthStatus } from "../src/server/claude.js";
import type { TurnActivity } from "../src/server/agent.js";

describe("getClaudeAuthStatus", () => {
  it("returns a non-secret status shape", async () => {
    const status = await getClaudeAuthStatus();
    expect(["signed-in", "signed-out", "unreachable"]).toContain(status.state);
    expect(JSON.stringify(status)).not.toMatch(/access_token|refresh_token|api_key|"email"|"orgId"/i);
    if (status.state === "signed-in") expect(status.accountType).not.toContain("@");
  }, 20_000);
});

class FakeClaudeProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  promptChunks: string[] = [];

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => this.promptChunks.push(chunk.toString("utf8")));
  }

  kill(): boolean {
    return true;
  }

  emitLine(event: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

interface ClientInternal {
  spawnClaude: (cwd: string, args: string[]) => FakeClaudeProcess;
}

function stubbedClient(client: ClaudeCodeClient, script: (child: FakeClaudeProcess, args: string[], turn: number) => void): { calls: string[][] } {
  const calls: string[][] = [];
  (client as unknown as ClientInternal).spawnClaude = (_cwd, args) => {
    calls.push(args);
    const child = new FakeClaudeProcess();
    queueMicrotask(() => script(child, args, calls.length));
    return child;
  };
  return { calls };
}

async function runSingleTurn(client: ClaudeCodeClient, prompt: string): Promise<string> {
  const thread = await client.startTextThread("/repo");
  try {
    return await thread.send(prompt);
  } finally {
    await thread.close();
  }
}

describe("ClaudeCodeClient", () => {
  it("reports labelled turn activity, returns the result text, and resumes the session for repair turns", async () => {
    const client = new ClaudeCodeClient();
    const { calls } = stubbedClient(client, (child, args, turn) => {
      child.emitLine({ type: "system", subtype: "init", session_id: "session-123" });
      child.emitLine({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: turn === 1 ? "draft" : "fixed" } }, session_id: "session-123" });
      child.emitLine({ type: "result", subtype: "success", is_error: false, result: turn === 1 ? "first response" : "second response", session_id: "session-123" });
      child.emit("close", 0);
    });

    const activities: TurnActivity[] = [];
    const thread = await client.startTextThread("/repo");
    await expect(thread.send("Explain this branch.", (activity) => activities.push(activity))).resolves.toBe("first response");
    await expect(thread.send("Repair the document.")).resolves.toBe("second response");
    await thread.close();

    expect(activities).toEqual([
      { label: "starting the analysis turn", notifications: 1, draftCharacters: 0 },
      { label: "drafting the narrative", notifications: 2, draftCharacters: 5 },
    ]);
    expect(calls[0]).not.toContain("--resume");
    expect(calls[1]).toContain("--resume");
    expect(calls[1][calls[1].indexOf("--resume") + 1]).toBe("session-123");
  });

  it("labels tool activity so heartbeats can say what Claude Code is doing", () => {
    expect(describeClaudeEvent({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git  diff --stat main...HEAD" } }] } })).toBe("running `git diff --stat main...HEAD`");
    expect(describeClaudeEvent({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/app.ts" } }] } })).toBe("reading src/app.ts");
    expect(describeClaudeEvent({ type: "assistant", message: { content: [{ type: "tool_use", name: "Grep", input: {} }] } })).toBe("searching the repository");
    expect(describeClaudeEvent({ type: "assistant", message: { content: [{ type: "text", text: "The branch…" }] } })).toBe("drafting the narrative");
    expect(describeClaudeEvent({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } } })).toBe("drafting the narrative");
    expect(describeClaudeEvent({ type: "system", subtype: "status" })).toBeUndefined();
  });

  it("runs read-only with the prompt delivered over stdin", async () => {
    const client = new ClaudeCodeClient();
    let observed: FakeClaudeProcess | undefined;
    const { calls } = stubbedClient(client, (child) => {
      observed = child;
      child.emitLine({ type: "result", subtype: "success", is_error: false, result: "ok", session_id: "session-123" });
      child.emit("close", 0);
    });

    await expect(runSingleTurn(client, "Explain this branch.")).resolves.toBe("ok");

    const args = calls[0];
    expect(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2)).toEqual(["--permission-mode", "dontAsk"]);
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", "Read,Grep,Glob,Bash"]);
    expect(args.slice(args.indexOf("--allowed-tools"), args.indexOf("--allowed-tools") + 2)).toEqual(["--allowed-tools", "Read,Grep,Glob,Bash(git *)"]);
    expect(args).toContain("--strict-mcp-config");
    expect(observed?.promptChunks.join("")).toBe("Explain this branch.");
  });

  it("rejects a turn the CLI reports as failed, with the reported reason", async () => {
    const client = new ClaudeCodeClient();
    stubbedClient(client, (child) => {
      child.emitLine({ type: "result", subtype: "error_during_execution", is_error: true, result: "rate limited", session_id: "session-123" });
      child.emit("close", 1);
    });

    await expect(runSingleTurn(client, "Explain this branch.")).rejects.toThrow("Claude Code analysis turn failed: rate limited");
  });

  it("fails when the CLI exits without a result, including stderr", async () => {
    const client = new ClaudeCodeClient();
    stubbedClient(client, (child) => {
      child.stderr.write("native module mismatch");
      child.emit("close", 1);
    });

    await expect(runSingleTurn(client, "Explain this branch.")).rejects.toThrow("exited with status 1 before reporting a result. Claude Code reported: native module mismatch");
  });

  it("times out on inactivity with progress diagnostics and the stderr tail", async () => {
    const client = new ClaudeCodeClient(20);
    stubbedClient(client, (child) => {
      child.emitLine({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "partial" } }, session_id: "session-123" });
      child.stderr.write("429 too many requests");
    });

    await expect(runSingleTurn(client, "Explain this branch.")).rejects.toThrow(/stalled: no CLI activity for 0s after 1 stream events and 7 draft characters\. Claude Code reported: 429 too many requests/);
  });
});
