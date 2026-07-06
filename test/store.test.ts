import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CollectedReviewInput } from "../src/server/git.js";
import { ReviewStore } from "../src/server/store.js";
import { buildTestAnalysis } from "./fixtures/analysis-fixture.js";

describe("ReviewStore", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
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
    expect(store.listLenses().map((lens) => lens.id)).toContain("security");
    store.setPreference("zoom", "3");
    expect(store.getPreference("zoom")).toBe("3");
    const question = store.createQuestion(revision.id, "export const reviewed", "Why is this included?");
    store.answerQuestion(question.id, "It establishes the reviewed state.", "branch");
    expect(store.listQuestions(revision.id)).toMatchObject([{ id: question.id, provenance: "branch" }]);
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
