import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestAnalysis } from "./fixtures/analysis-fixture.js";
import { writeReviewArtifact } from "../src/server/artifact.js";
import { GitReader } from "../src/server/git.js";
import { createReviewPresentationData } from "../src/server/review-presentation.js";
import { ReviewStore } from "../src/server/store.js";

const run = promisify(execFile);

describe("review artifact e2e", () => {
  let workspace: string | undefined;

  afterEach(async () => {
    if (workspace !== undefined) await rm(workspace, { recursive: true, force: true });
  });

  it("collects a new repository review and writes a portable artifact under .ndrstnd", async () => {
    workspace = await mkdtemp(join(tmpdir(), "ndrstnd-e2e-"));
    const repository = join(workspace, "repo");
    await git(workspace, ["init", "-b", "main", "repo"]);
    await writeFile(join(repository, "app.ts"), "export const enabled = true;\n");
    await writeFile(join(repository, "app.test.ts"), "test('enables the app', () => expect(enabled).toBe(true));\n");

    const input = await new GitReader().collectReviewInput(repository, "WORKTREE", "empty");
    const store = new ReviewStore(join(workspace, "store.sqlite"));
    try {
      const session = store.getOrCreateSession(input);
      const revision = store.createRevision(session.id, "codex", "complete", buildTestAnalysis(input));
      const artifactPath = await writeReviewArtifact(session, revision, { directory: join(repository, ".ndrstnd"), now: new Date("2026-07-02T12:00:00.000Z") });
      const artifact = await readFile(artifactPath, "utf8");

      expect(artifactPath).toMatch(/\.ndrstnd\/ndrstnd-2026-07-02T12-00-00-000Z-/);
      expect(artifact).toContain("<!doctype html>");
      expect(artifact).toContain("app.ts");
      expect(artifact).toContain("app.test.ts");
      expect(artifact).toContain("Copy Codex prompt");
      expect(artifact).toContain("Prompt copied");
    } finally {
      store.close();
    }
  });
});

async function git(cwd: string, args: string[]): Promise<void> {
  await run("git", args, { cwd });
}
