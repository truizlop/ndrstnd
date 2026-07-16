import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CollectedReviewInput } from "../src/server/git.js";
import { ReviewStore, selectReusableRevision, type AnalysisRevision } from "../src/server/store.js";
import { buildTestAnalysis } from "./fixtures/analysis-fixture.js";

describe("ReviewStore", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("converges concurrent connections on one session per input", async () => {
    directory = await mkdtemp(join(tmpdir(), "ndrstnd-store-"));
    const databasePath = join(directory, "state.sqlite");
    const first = new ReviewStore(databasePath);
    const second = new ReviewStore(databasePath);

    const sessionA = first.getOrCreateSession(sampleInput());
    const sessionB = second.getOrCreateSession(sampleInput());

    expect(sessionB.id).toBe(sessionA.id);
    first.close();
    second.close();
  });

  it("treats cached documents that no longer validate or belong to another version as absent", async () => {
    directory = await mkdtemp(join(tmpdir(), "ndrstnd-store-"));
    const databasePath = join(directory, "state.sqlite");
    const store = new ReviewStore(databasePath);
    const session = store.getOrCreateSession(sampleInput());
    const good = store.createRevision(session.id, "codex", "complete", buildTestAnalysis(sampleInput()));

    const database = (store as unknown as { database: import("better-sqlite3").Database }).database;
    database.prepare("INSERT INTO analysis_revision (id, session_id, status, source, document_json, document_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("corrupt", session.id, "complete", "codex", "{\"summary\":\"not a full document\"}", null, "2099-01-01T00:00:00.000Z");
    database.prepare("INSERT INTO analysis_revision (id, session_id, status, source, document_json, document_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("future", session.id, "complete", "codex", JSON.stringify(buildTestAnalysis(sampleInput())), 99, "2099-01-02T00:00:00.000Z");

    expect(store.listRevisions(session.id).map((revision) => revision.id)).toEqual([good.id]);
    store.close();
  });

  it("only reuses complete revisions produced by the requested agent", () => {
    const base = { id: "r", sessionId: "s", document: buildTestAnalysis(sampleInput()), createdAt: "2026-07-08T00:00:00.000Z" };
    const revisions: AnalysisRevision[] = [
      { ...base, id: "codex-partial", source: "codex", status: "partial" },
      { ...base, id: "claude-complete", source: "claude", status: "complete" },
      { ...base, id: "pi-complete", source: "pi", status: "complete" },
      { ...base, id: "codex-complete", source: "codex", status: "complete" },
    ];

    expect(selectReusableRevision(revisions, "codex")?.id).toBe("codex-complete");
    expect(selectReusableRevision(revisions, "claude")?.id).toBe("claude-complete");
    expect(selectReusableRevision(revisions, "pi")?.id).toBe("pi-complete");
    expect(selectReusableRevision(revisions.slice(0, 1), "codex")).toBeUndefined();
  });

  it("persists and reuses an unchanged review input", async () => {
    directory = await mkdtemp(join(tmpdir(), "ndrstnd-store-"));
    const databasePath = join(directory, "state.sqlite");
    const store = new ReviewStore(databasePath);
    const conversation = { source: "portable-json" as const, messages: [{ role: "user" as const, text: "Explain the change" }] };
    const first = store.getOrCreateSession(sampleInput(), conversation);
    const second = store.getOrCreateSession(sampleInput(), conversation);
    expect(second.id).toBe(first.id);
    const revision = store.createRevision(first.id, "codex", "complete", buildTestAnalysis(sampleInput()));
    expect(store.listRevisions(first.id)).toMatchObject([{ id: revision.id, source: "codex" }]);
    store.close();

    const reopened = new ReviewStore(databasePath);
    expect(reopened.getSession(first.id)).toMatchObject({ id: first.id, targetRef: "agent-change", conversation, input: { hunks: [{ id: "hunk-1" }] } });
    reopened.close();
  });
});

function sampleInput(): CollectedReviewInput {
  return {
    repoPath: "/example/repository",
    targetRef: "agent-change",
    baseRef: "main",
    mergeBase: "abc123",
    files: [{ id: "file-1", path: "app.ts", status: "modified", binary: false, signal: "meaningful" }],
    hunks: [{ id: "hunk-1", fileId: "file-1", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "export const reviewed = true;", newLine: 1 }] }],
  };
}
