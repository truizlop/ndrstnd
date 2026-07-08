import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitReader, describeReviewScope, ensureArtifactDirectoryIgnored } from "../src/server/git.js";

const run = promisify(execFile);

describe("GitReader", () => {
  let repository: string | undefined;

  afterEach(async () => {
    if (repository !== undefined) await rm(repository, { recursive: true, force: true });
  });

  it("compares a branch to its merge-base and accounts for meaningful and lockfile changes", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.email", "ndrstnd@example.test"]);
    await git(repository, ["config", "user.name", "ndrstnd Test"]);
    await writeFile(join(repository, "app.ts"), "export const greeting = 'hello';\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    await git(repository, ["switch", "-c", "agent-change"]);
    await writeFile(join(repository, "app.ts"), "export const greeting = 'hello, reviewer';\nexport const enabled = true;\n");
    await writeFile(join(repository, "package-lock.json"), "{\"lockfileVersion\":3}\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "agent change"]);
    await git(repository, ["switch", "main"]);

    const input = await new GitReader().collectReviewInput(repository, "agent-change");

    expect(input.baseRef).toBe("HEAD");
    expect(input.files.map((file) => file.path)).toEqual(["app.ts", "package-lock.json"]);
    expect(input.files.find((file) => file.path === "package-lock.json")).toMatchObject({ signal: "low-signal", signalReason: "Lockfile" });
    expect(input.hunks).toHaveLength(2);
    expect(input.hunks.flatMap((hunk) => hunk.lines)).toContainEqual(expect.objectContaining({ kind: "addition", content: "export const enabled = true;", newLine: 2 }));
  });

  it("uses a target branch upstream when reviewing the checked-out target", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.email", "ndrstnd@example.test"]);
    await git(repository, ["config", "user.name", "ndrstnd Test"]);
    await writeFile(join(repository, "base.txt"), "base\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    await git(repository, ["switch", "-c", "agent-change"]);
    await git(repository, ["branch", "--set-upstream-to", "main"]);
    await writeFile(join(repository, "change.txt"), "change\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "agent change"]);

    const input = await new GitReader().collectReviewInput(repository, "agent-change");

    expect(input.baseRef).toBe("main");
    expect(input.files.map((file) => file.path)).toEqual(["change.txt"]);
  });

  it("includes committed, staged, unstaged, and untracked current-branch changes against an explicit base", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.email", "ndrstnd@example.test"]);
    await git(repository, ["config", "user.name", "ndrstnd Test"]);
    await writeFile(join(repository, "app.ts"), "export const version = 1;\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    await git(repository, ["switch", "-c", "agent-change"]);
    await writeFile(join(repository, "app.ts"), "export const version = 2;\n");
    await git(repository, ["add", "app.ts"]);
    await git(repository, ["commit", "-m", "committed branch change"]);
    await writeFile(join(repository, "staged.ts"), "export const staged = true;\n");
    await git(repository, ["add", "staged.ts"]);
    await writeFile(join(repository, "app.ts"), "export const version = 3;\n");
    await writeFile(join(repository, "untracked.ts"), "export const untracked = true;\n");

    const input = await new GitReader().collectReviewInput(repository, "agent-change", "main");

    expect(input.baseRef).toBe("main");
    expect(input.includesWorkingTree).toBe(true);
    expect(input.files.map((file) => file.path)).toEqual(["app.ts", "staged.ts", "untracked.ts"]);
    expect(input.hunks.flatMap((hunk) => hunk.lines)).toContainEqual(expect.objectContaining({ kind: "deletion", content: "export const version = 1;" }));
    expect(input.hunks.flatMap((hunk) => hunk.lines)).toContainEqual(expect.objectContaining({ kind: "addition", content: "export const version = 3;" }));
    expect(input.hunks.flatMap((hunk) => hunk.lines)).toContainEqual(expect.objectContaining({ kind: "addition", content: "export const staged = true;" }));
    expect(input.hunks.flatMap((hunk) => hunk.lines)).toContainEqual(expect.objectContaining({ kind: "addition", content: "export const untracked = true;" }));
  });

  it("keeps hunks for files whose names require quoted diff headers", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.email", "ndrstnd@example.test"]);
    await git(repository, ["config", "user.name", "ndrstnd Test"]);
    await writeFile(join(repository, "base.txt"), "base\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    await git(repository, ["switch", "-c", "agent-change"]);
    await writeFile(join(repository, "café.txt"), "committed unicode\n");
    await mkdir(join(repository, "a b"));
    await writeFile(join(repository, "a b", "c.txt"), "committed spaced\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "special names"]);
    await writeFile(join(repository, "naïve.txt"), "untracked unicode\n");

    const input = await new GitReader().collectReviewInput(repository, "agent-change", "main");

    const byPath = new Map(input.files.map((file) => [file.path, file]));
    expect(byPath.get("café.txt")).toMatchObject({ binary: false, signal: "meaningful" });
    expect(byPath.get("a b/c.txt")).toMatchObject({ binary: false, signal: "meaningful" });
    expect(byPath.get("naïve.txt")).toMatchObject({ binary: false, signal: "meaningful" });
    const additions = input.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.kind === "addition").map((line) => line.content);
    expect(additions).toEqual(expect.arrayContaining(["committed unicode", "committed spaced", "untracked unicode"]));
  });

  it("keeps upstream commits landed after the fork point out of a working-tree review", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.email", "ndrstnd@example.test"]);
    await git(repository, ["config", "user.name", "ndrstnd Test"]);
    await writeFile(join(repository, "shared.txt"), "shared\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    await git(repository, ["switch", "-c", "agent-change"]);
    await writeFile(join(repository, "branch.txt"), "branch work\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "branch work"]);
    await git(repository, ["switch", "main"]);
    await writeFile(join(repository, "upstream.txt"), "landed after the fork\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "upstream drift"]);
    await git(repository, ["switch", "agent-change"]);

    const input = await new GitReader().collectReviewInput(repository, "agent-change", "main");

    expect(input.includesWorkingTree).toBe(true);
    expect(input.files.map((file) => file.path)).toEqual(["branch.txt"]);
  });

  it("reviews a non-checked-out target against the empty tree", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.email", "ndrstnd@example.test"]);
    await git(repository, ["config", "user.name", "ndrstnd Test"]);
    await writeFile(join(repository, "first.ts"), "export const first = true;\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    await git(repository, ["switch", "-c", "feature"]);
    await writeFile(join(repository, "feature.ts"), "export const feature = true;\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "feature"]);
    await git(repository, ["switch", "main"]);

    const input = await new GitReader().collectReviewInput(repository, "feature", "empty");

    expect(input.baseRef).toBe("empty");
    expect(input.files.map((file) => file.path).sort()).toEqual(["feature.ts", "first.ts"]);
    expect(input.files).toMatchObject([expect.objectContaining({ status: "added" }), expect.objectContaining({ status: "added" })]);
  });

  it("marks committed and untracked binary files without collecting their payload", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.email", "ndrstnd@example.test"]);
    await git(repository, ["config", "user.name", "ndrstnd Test"]);
    await writeFile(join(repository, "base.txt"), "base\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    await git(repository, ["switch", "-c", "agent-change"]);
    await writeFile(join(repository, "asset.bin"), Buffer.from([0, 1, 2, 3, 0, 255, 254]));
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "binary asset"]);
    await writeFile(join(repository, "untracked.bin"), Buffer.from([0, 9, 8, 7, 0]));

    const input = await new GitReader().collectReviewInput(repository, "agent-change", "main");

    const byPath = new Map(input.files.map((file) => [file.path, file]));
    expect(byPath.get("asset.bin")).toMatchObject({ binary: true, signal: "low-signal", signalReason: "Binary change" });
    expect(byPath.get("untracked.bin")).toMatchObject({ binary: true, signal: "low-signal", signalReason: "Binary change" });
    expect(input.hunks).toHaveLength(0);
  });

  it("reports a pure rename as a rename rather than a binary change", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.email", "ndrstnd@example.test"]);
    await git(repository, ["config", "user.name", "ndrstnd Test"]);
    await writeFile(join(repository, "before.ts"), "export const stable = true;\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    await git(repository, ["switch", "-c", "agent-change"]);
    await git(repository, ["mv", "before.ts", "after.ts"]);
    await git(repository, ["commit", "-m", "rename"]);
    await git(repository, ["switch", "main"]);

    const input = await new GitReader().collectReviewInput(repository, "agent-change");

    expect(input.files).toMatchObject([
      { path: "after.ts", previousPath: "before.ts", status: "renamed", binary: false, signal: "low-signal", signalReason: "Rename without content changes" },
    ]);
  });

  it("infers the checked-out branch base for a worktree review", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.email", "ndrstnd@example.test"]);
    await git(repository, ["config", "user.name", "ndrstnd Test"]);
    await writeFile(join(repository, "base.txt"), "base\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    await git(repository, ["switch", "-c", "agent-change"]);
    await git(repository, ["branch", "--set-upstream-to", "main"]);
    await writeFile(join(repository, "worktree.txt"), "dirty\n");

    const input = await new GitReader().collectReviewInput(repository, "WORKTREE");

    expect(input.baseRef).toBe("main");
    expect(input.includesWorkingTree).toBe(true);
    expect(input.files.map((file) => file.path)).toEqual(["worktree.txt"]);
  });

  it("describes the scope with the local commits an inferred base pulls into a worktree review", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.email", "ndrstnd@example.test"]);
    await git(repository, ["config", "user.name", "ndrstnd Test"]);
    await writeFile(join(repository, "base.txt"), "base\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    await git(repository, ["switch", "-c", "agent-change"]);
    await git(repository, ["branch", "--set-upstream-to", "main"]);
    await writeFile(join(repository, "committed.txt"), "committed\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "local commit"]);
    await writeFile(join(repository, "dirty.txt"), "dirty\n");

    const reader = new GitReader();
    const inferred = await reader.collectReviewInput(repository, "WORKTREE");
    expect(await describeReviewScope(repository, inferred)).toEqual({ targetLabel: "agent-change", localCommitsIncluded: 1 });

    const uncommittedOnly = await reader.collectReviewInput(repository, "WORKTREE", "HEAD");
    expect(await describeReviewScope(repository, uncommittedOnly)).toEqual({ targetLabel: "agent-change", localCommitsIncluded: 0 });
    expect(uncommittedOnly.files.map((file) => file.path)).toEqual(["dirty.txt"]);
  });

  it("excludes the artifact directory from reviews of repositories that do not ignore it", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.email", "ndrstnd@example.test"]);
    await git(repository, ["config", "user.name", "ndrstnd Test"]);
    await writeFile(join(repository, "base.txt"), "base\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    await mkdir(join(repository, ".ndrstnd"));
    await writeFile(join(repository, ".ndrstnd", "ndrstnd-old-review.html"), "<html></html>\n");
    await writeFile(join(repository, "dirty.txt"), "dirty\n");

    await ensureArtifactDirectoryIgnored(repository);
    await ensureArtifactDirectoryIgnored(repository);

    const input = await new GitReader().collectReviewInput(repository, "WORKTREE", "HEAD");
    expect(input.files.map((file) => file.path)).toEqual(["dirty.txt"]);
    const exclude = await readFile(join(repository, ".git", "info", "exclude"), "utf8");
    expect(exclude.match(/\.ndrstnd\//g)).toHaveLength(1);
  });

  it("reviews an initial uncommitted repository against the empty tree", async () => {
    repository = await mkdtemp(join(tmpdir(), "ndrstnd-git-"));
    await git(repository, ["init", "-b", "main"]);
    await writeFile(join(repository, "first.ts"), "export const first = true;\n");

    const input = await new GitReader().collectReviewInput(repository, "WORKTREE", "empty");

    expect(input.baseRef).toBe("empty");
    expect(input.includesWorkingTree).toBe(true);
    expect(input.files).toMatchObject([{ path: "first.ts", status: "added" }]);
    expect(input.hunks.flatMap((hunk) => hunk.lines)).toContainEqual(expect.objectContaining({ kind: "addition", content: "export const first = true;" }));
  });
});

async function git(cwd: string, args: string[]): Promise<void> {
  await run("git", args, { cwd });
}
