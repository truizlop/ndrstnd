import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitReader } from "../src/server/git.js";

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
