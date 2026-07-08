import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { ChangedFile, DiffHunk } from "../shared/domain.js";
import { finalizeFiles, parseNameStatus, parsePatch, untrackedFiles } from "./git-model.js";

const execFile = promisify(execFileCallback);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface CollectedReviewInput {
  repoPath: string;
  targetRef: string;
  baseRef: string;
  mergeBase: string;
  includesWorkingTree?: boolean;
  files: ChangedFile[];
  hunks: DiffHunk[];
}

export interface GitRepositoryReader {
  collectReviewInput(repoPath: string, targetRef: string, explicitBaseRef?: string): Promise<CollectedReviewInput>;
}

export class GitReader implements GitRepositoryReader {
  async collectReviewInput(repoPath: string, targetRef: string, explicitBaseRef?: string): Promise<CollectedReviewInput> {
    await git(repoPath, ["rev-parse", "--show-toplevel"]);
    const workingTreeTarget = targetRef === "WORKTREE";
    if (!workingTreeTarget) await git(repoPath, ["rev-parse", "--verify", targetRef]);

    const baseTargetRef = workingTreeTarget ? await resolveWorktreeTargetRef(repoPath) : targetRef;
    const baseRef = explicitBaseRef === "empty" ? EMPTY_TREE : explicitBaseRef ?? await resolveBaseRef(repoPath, baseTargetRef);
    if (baseRef !== EMPTY_TREE) await git(repoPath, ["rev-parse", "--verify", baseRef]);
    const head = await gitOptional(repoPath, ["rev-parse", "HEAD"]);
    const target = workingTreeTarget ? head?.trim() : (await git(repoPath, ["rev-parse", targetRef])).trim();
    const includeWorkingTree = workingTreeTarget || (head !== undefined && head.trim() === target);
    if (target === undefined && baseRef !== EMPTY_TREE) throw new Error("A repository without commits needs `--base empty` for a working-tree review.");
    const mergeBase = baseRef === EMPTY_TREE ? EMPTY_TREE : (await git(repoPath, ["merge-base", baseRef, target ?? baseRef])).trim();
    // Diffing the merge-base rather than the base tip keeps upstream commits landed after the fork point out of the review.
    const comparison = includeWorkingTree ? [mergeBase] : [mergeBase, targetRef];
    const nameStatus = await git(repoPath, ["diff", "--name-status", "-z", "--find-renames", "--find-copies", ...comparison]);
    const trackedFiles = parseNameStatus(nameStatus);
    const patch = await git(repoPath, ["diff", "--no-ext-diff", "--unified=3", "--find-renames", "--find-copies", "--binary", ...comparison]);
    const untracked = includeWorkingTree ? await collectUntrackedPatch(repoPath, trackedFiles) : { files: [], patch: "" };
    const files = [...trackedFiles, ...untracked.files];
    const parsedPatch = parsePatch(`${patch}\n${untracked.patch}`, files);
    const hunks = parsedPatch.hunks;
    const finalizedFiles = finalizeFiles(files, hunks, parsedPatch.binaryFileIds);

    return { repoPath, targetRef, baseRef: explicitBaseRef === "empty" ? "empty" : baseRef, mergeBase, includesWorkingTree: includeWorkingTree, files: finalizedFiles, hunks };
  }
}

export interface ReviewScope {
  targetLabel: string;
  localCommitsIncluded: number;
}

/** Describes what a collected review covers so the CLI can confirm the scope before the expensive analysis. */
export async function describeReviewScope(repoPath: string, input: CollectedReviewInput): Promise<ReviewScope> {
  const targetLabel = input.targetRef === "WORKTREE" ? await resolveWorktreeTargetRef(repoPath) : input.targetRef;
  if (input.includesWorkingTree !== true || input.baseRef === "empty") return { targetLabel, localCommitsIncluded: 0 };
  const count = await gitOptional(repoPath, ["rev-list", "--count", `${input.baseRef}..HEAD`]);
  return { targetLabel, localCommitsIncluded: Number(count?.trim() ?? "0") };
}

async function collectUntrackedPatch(repoPath: string, files: ChangedFile[]): Promise<{ files: ChangedFile[]; patch: string }> {
  const untracked = (await git(repoPath, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  const patches: string[] = [];
  for (const path of untracked) {
    patches.push(await gitAllowDifference(repoPath, ["diff", "--no-index", "--unified=3", "--binary", "--", "/dev/null", path]));
  }
  return { files: untrackedFiles(untracked, files), patch: patches.join("\n") };
}

async function resolveBaseRef(repoPath: string, targetRef: string): Promise<string> {
  const head = (await git(repoPath, ["rev-parse", "HEAD"])).trim();
  const target = (await git(repoPath, ["rev-parse", targetRef])).trim();
  if (head !== target) {
    return "HEAD";
  }

  const upstream = await gitOptional(repoPath, ["rev-parse", "--abbrev-ref", `${targetRef}@{upstream}`]);
  if (upstream !== undefined) {
    return upstream.trim();
  }
  for (const candidate of ["main", "master", "origin/main", "origin/master"]) {
    if (candidate === targetRef) {
      continue;
    }
    if (await gitOptional(repoPath, ["rev-parse", "--verify", candidate]) !== undefined) {
      return candidate;
    }
  }
  throw new Error(`Cannot infer a base for ${targetRef}. Check out its base branch or configure an upstream branch.`);
}

async function resolveWorktreeTargetRef(repoPath: string): Promise<string> {
  const branch = await gitOptional(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return branch?.trim() || "HEAD";
}

async function git(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["-C", repoPath, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Git could not ${args.join(" ")}: ${detail}`);
  }
}

async function gitOptional(repoPath: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(repoPath, args);
  } catch {
    return undefined;
  }
}

async function gitAllowDifference(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["-C", repoPath, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const result = error as { code?: number; stdout?: string };
    if (result.code === 1 && typeof result.stdout === "string") return result.stdout;
    throw error;
  }
}
