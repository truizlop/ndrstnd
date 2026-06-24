import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupArtifacts, writeReviewArtifact } from "../src/server/artifact.js";
import { buildFallbackAnalysis } from "../src/server/analyze.js";
import type { StoredReviewSession } from "../src/server/store.js";

function session(): StoredReviewSession {
  const input = { repoPath: "/repo", targetRef: "WORKTREE", baseRef: "main", mergeBase: "abcdef123456", files: [{ id: "file", path: "app.ts", status: "modified" as const, binary: false, signal: "meaningful" as const }], hunks: [{ id: "hunk", fileId: "file", oldStart: 1, newStart: 1, lines: [{ kind: "addition" as const, content: "artifact = true;", newLine: 1 }] }] };
  return { id: "session", repoPath: input.repoPath, targetRef: input.targetRef, baseRef: input.baseRef, mergeBase: input.mergeBase, inputHash: "hash", input, createdAt: "now" };
}

describe("ndrstnd artifacts", () => {
  it("writes a private self-contained review in the artifact directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ndrstnd-artifact-"));
    const input = session();
    const revision = { id: "revision", sessionId: input.id, source: "fallback" as const, status: "partial" as const, document: buildFallbackAnalysis(input.input), createdAt: "2026-06-20T10:00:00.000Z" };
    const path = await writeReviewArtifact(input, revision, { directory, now: new Date("2026-06-20T10:00:00.000Z") });
    const html = await readFile(path, "utf8");

    expect(path).toContain(directory);
    expect(html).toContain("ndrstnd");
    expect(html).toContain("artifact ");
    expect(html).not.toContain("/api/");
    expect(html).not.toContain("127.0.0.1");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("removes only expired ndrstnd artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ndrstnd-artifact-"));
    const oldArtifact = join(directory, "ndrstnd-old.html");
    const otherFile = join(directory, "keep.html");
    await writeFile(oldArtifact, "old");
    await writeFile(otherFile, "keep");
    await utimes(oldArtifact, new Date("2026-06-01"), new Date("2026-06-01"));
    await cleanupArtifacts(directory, new Date("2026-06-20"));
    await expect(stat(oldArtifact)).rejects.toThrow();
    await expect(readFile(otherFile, "utf8")).resolves.toBe("keep");
  });
});
