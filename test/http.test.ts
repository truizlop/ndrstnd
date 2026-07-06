import { afterEach, describe, expect, it } from "vitest";
import { startReviewServer, type ReviewServer } from "../src/server/http.js";
import { ReviewStore } from "../src/server/store.js";
import { buildTestAnalysis } from "./fixtures/analysis-fixture.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("startReviewServer", () => {
  let server: ReviewServer | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    await server?.close();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("serves a loopback health endpoint and protects the workspace URL", async () => {
    server = await startReviewServer();
    const healthUrl = new URL("/api/health", server.url);
    const health = await fetch(healthUrl);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });

    const workspace = await fetch(server.url);
    expect(workspace.status).toBe(200);
    await expect(workspace.text()).resolves.toContain("ndrstnd");

    const denied = await fetch(new URL("/", server.url));
    expect(denied.status).toBe(404);
  });

  it("exposes persisted lenses to the token-protected workspace", async () => {
    directory = await mkdtemp(join(tmpdir(), "ndrstnd-http-"));
    const store = new ReviewStore(join(directory, "state.sqlite"));
    const input = { repoPath: "/repo", targetRef: "agent", baseRef: "main", mergeBase: "base", files: [{ id: "file", path: "app.ts", status: "modified" as const, binary: false, signal: "meaningful" as const }], hunks: [{ id: "hunk", fileId: "file", oldStart: 1, newStart: 1, lines: [] }] };
    const session = store.getOrCreateSession(input);
    const revision = store.createRevision(session.id, "codex", "complete", buildTestAnalysis(input));
    server = await startReviewServer({ session, revision, store });

    const lensUrl = new URL(server.url);
    lensUrl.pathname = "/api/lenses";
    const lenses = await fetch(lensUrl);
    expect(lenses.status).toBe(200);
    await expect(lenses.json()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "security" })]));
    store.close();
  });
});
