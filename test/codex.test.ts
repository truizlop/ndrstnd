import { describe, expect, it, vi } from "vitest";
import { CodexAppServerClient, getCodexAuthStatus } from "../src/server/codex.js";

describe("getCodexAuthStatus", () => {
  it("returns a non-secret status shape", async () => {
    const status = await getCodexAuthStatus();
    expect(["signed-in", "signed-out", "unreachable"]).toContain(status.state);
    expect(JSON.stringify(status)).not.toMatch(/access_token|refresh_token|api_key/i);
  }, 20_000);
});

describe("CodexAppServerClient", () => {
  it("archives an analysis thread after its turn completes", async () => {
    const client = new CodexAppServerClient();
    const internal = client as unknown as {
      request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
      handleOutput: (chunk: string) => void;
    };
    const request = vi.fn(async (method: string) => {
      if (method === "thread/start") return { thread: { id: "analysis-thread" } };
      if (method === "turn/start") {
        queueMicrotask(() => internal.handleOutput('{"method":"turn/completed","params":{"threadId":"analysis-thread"}}\n'));
      }
      return {};
    });
    internal.request = request;

    await expect(client.runTextTurn("/repo", "Explain this branch.")).resolves.toBe("");

    expect(request).toHaveBeenCalledWith("thread/archive", { threadId: "analysis-thread" });
  });
});
