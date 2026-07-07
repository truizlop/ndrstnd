import { describe, expect, it, vi } from "vitest";
import { CodexAppServerClient, describeThreadNotification, getCodexAuthStatus, type TurnActivity } from "../src/server/codex.js";

describe("getCodexAuthStatus", () => {
  it("returns a non-secret status shape", async () => {
    const status = await getCodexAuthStatus();
    expect(["signed-in", "signed-out", "unreachable"]).toContain(status.state);
    expect(JSON.stringify(status)).not.toMatch(/access_token|refresh_token|api_key/i);
  }, 20_000);
});

interface ClientInternal {
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  handleOutput: (chunk: string) => void;
  fail: (error: Error) => void;
  stderrTail: string;
}

function stubbedClient(client: CodexAppServerClient, onTurnStart?: (internal: ClientInternal) => void): ClientInternal {
  const internal = client as unknown as ClientInternal;
  internal.request = vi.fn(async (method: string) => {
    if (method === "thread/start") return { thread: { id: "analysis-thread" } };
    if (method === "turn/start") onTurnStart?.(internal);
    return {};
  });
  return internal;
}

describe("CodexAppServerClient", () => {
  it("archives an analysis thread after its turn completes", async () => {
    const client = new CodexAppServerClient();
    const internal = stubbedClient(client, () => {
      queueMicrotask(() => internal.handleOutput('{"method":"turn/completed","params":{"threadId":"analysis-thread"}}\n'));
    });

    await expect(client.runTextTurn("/repo", "Explain this branch.")).resolves.toBe("");

    expect(internal.request).toHaveBeenCalledWith("thread/archive", { threadId: "analysis-thread" });
  });

  it("fails a running turn immediately when the app-server dies, including stderr", async () => {
    const client = new CodexAppServerClient();
    const internal = stubbedClient(client, () => {
      queueMicrotask(() => internal.fail(new Error("Codex app-server exited with status 1. Codex app-server reported: native module mismatch")));
    });

    await expect(client.runTextTurn("/repo", "Explain this branch.")).rejects.toThrow("exited with status 1. Codex app-server reported: native module mismatch");
  });

  it("rejects a turn the app-server reports as failed, with the reported reason", async () => {
    const client = new CodexAppServerClient();
    const internal = stubbedClient(client, () => {
      queueMicrotask(() => internal.handleOutput('{"method":"turn/failed","params":{"threadId":"analysis-thread","error":{"message":"sandbox denied file read"}}}\n'));
    });

    await expect(client.runTextTurn("/repo", "Explain this branch.")).rejects.toThrow("Codex analysis turn failed: sandbox denied file read");
  });

  it("reports labelled turn activity so callers can print heartbeats", async () => {
    const client = new CodexAppServerClient();
    const internal = stubbedClient(client, () => {
      queueMicrotask(() => {
        internal.handleOutput('{"method":"turn/started","params":{"threadId":"analysis-thread"}}\n');
        internal.handleOutput('{"method":"item/started","params":{"threadId":"analysis-thread","item":{"type":"commandExecution","command":"git diff --stat main...HEAD"}}}\n');
        internal.handleOutput('{"method":"item/agentMessage/delta","params":{"threadId":"analysis-thread","delta":"{\\"s\\":"}}\n');
        internal.handleOutput('{"method":"turn/completed","params":{"threadId":"analysis-thread"}}\n');
      });
    });
    const activities: TurnActivity[] = [];

    await client.runTextTurn("/repo", "Explain this branch.", (activity) => activities.push(activity));

    expect(activities[0]).toEqual({ label: "starting the analysis turn", notifications: 1, draftCharacters: 0 });
    expect(activities[1]).toEqual({ label: "running `git diff --stat main...HEAD`", notifications: 2, draftCharacters: 0 });
    expect(activities[2]).toEqual({ label: "drafting the narrative", notifications: 3, draftCharacters: 5 });
  });

  it("describes app-server notifications in reviewer-facing language", () => {
    expect(describeThreadNotification("item/completed", { item: { type: "commandExecution", command: "git   diff\n--stat" } })).toBe("finished `git diff --stat`");
    expect(describeThreadNotification("item/started", { item: { type: "reasoning" } })).toBe("reasoning about the branch");
    expect(describeThreadNotification("item/started", { item: { type: "agentMessage" } })).toBe("drafting the narrative");
    expect(describeThreadNotification("thread/tokenUsage/updated", {})).toBeUndefined();
  });

  it("times out on inactivity with progress diagnostics and the stderr tail", async () => {
    const client = new CodexAppServerClient(20);
    const internal = stubbedClient(client, () => {
      internal.handleOutput('{"method":"item/agentMessage/delta","params":{"threadId":"analysis-thread","delta":"partial"}}\n');
    });
    internal.stderrTail = "429 too many requests";

    await expect(client.runTextTurn("/repo", "Explain this branch.")).rejects.toThrow(/stalled: no app-server activity for 0s after 1 thread notifications and 7 draft characters\. Codex app-server reported: 429 too many requests/);
  });
});
