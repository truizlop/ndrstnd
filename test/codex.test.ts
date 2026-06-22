import { describe, expect, it } from "vitest";
import { getCodexAuthStatus } from "../src/server/codex.js";

describe("getCodexAuthStatus", () => {
  it("returns a non-secret status shape", async () => {
    const status = await getCodexAuthStatus();
    expect(["signed-in", "signed-out", "unreachable"]).toContain(status.state);
    expect(JSON.stringify(status)).not.toMatch(/access_token|refresh_token|api_key/i);
  }, 20_000);
});
