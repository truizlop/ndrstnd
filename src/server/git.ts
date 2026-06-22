import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { ChangedFile, DiffHunk, DiffLine, FileSignal } from "../shared/domain.js";

const execFile = promisify(execFileCallback);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface CollectedReviewInput {
  repoPath: string;
  targetRef: string;
  baseRef: string;
  mergeBase: string;
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

    const baseRef = explicitBaseRef === "empty" ? EMPTY_TREE : explicitBaseRef ?? await resolveBaseRef(repoPath, targetRef);
    if (baseRef !== EMPTY_TREE) await git(repoPath, ["rev-parse", "--verify", baseRef]);
    const head = await gitOptional(repoPath, ["rev-parse", "HEAD"]);
    const target = workingTreeTarget ? head?.trim() : (await git(repoPath, ["rev-parse", targetRef])).trim();
    const includeWorkingTree = workingTreeTarget || (head !== undefined && head.trim() === target);
    if (target === undefined && baseRef !== EMPTY_TREE) throw new Error("A repository without commits needs `--base empty` for a working-tree review.");
    const mergeBase = baseRef === EMPTY_TREE ? EMPTY_TREE : (await git(repoPath, ["merge-base", baseRef, target ?? baseRef])).trim();
    const comparison = includeWorkingTree ? baseRef : `${mergeBase}...${targetRef}`;
    const nameStatus = await git(repoPath, ["diff", "--name-status", "-z", "--find-renames", "--find-copies", comparison]);
    const files = parseNameStatus(nameStatus);
    const patch = await git(repoPath, ["diff", "--no-ext-diff", "--unified=3", "--find-renames", "--find-copies", "--binary", comparison]);
    const untrackedPatch = includeWorkingTree ? await collectUntrackedPatch(repoPath, files) : "";
    const hunks = parsePatch(`${patch}\n${untrackedPatch}`, files);

    const hunkFileIds = new Set(hunks.map((hunk) => hunk.fileId));
    for (const file of files) {
      if (!hunkFileIds.has(file.id) && !file.binary) {
        file.binary = true;
      }
      const classification = classifyFile(file.path, file.binary);
      file.signal = classification.signal;
      file.signalReason = classification.reason;
    }

    return { repoPath, targetRef, baseRef: explicitBaseRef === "empty" ? "empty" : baseRef, mergeBase, files, hunks };
  }
}

async function collectUntrackedPatch(repoPath: string, files: ChangedFile[]): Promise<string> {
  const knownPaths = new Set(files.map((file) => file.path));
  const untracked = (await git(repoPath, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  const patches: string[] = [];
  for (const path of untracked) {
    if (!knownPaths.has(path)) files.push({ id: stableId(path), path, status: "added", binary: false, signal: "meaningful" });
    patches.push(await gitAllowDifference(repoPath, ["diff", "--no-index", "--unified=3", "--binary", "--", "/dev/null", path]));
  }
  return patches.join("\n");
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

function parseNameStatus(output: string): ChangedFile[] {
  const fields = output.split("\0");
  const files: ChangedFile[] = [];
  for (let index = 0; index < fields.length - 1; ) {
    const statusField = fields[index++];
    if (statusField === undefined || statusField === "") continue;
    const code = statusField[0] ?? "?";
    const path = fields[index++] ?? "";
    const previousPath = code === "R" || code === "C" ? path : undefined;
    const finalPath = previousPath === undefined ? path : fields[index++] ?? path;
    files.push({ id: stableId(finalPath), path: finalPath, previousPath, status: statusFor(code), binary: false, signal: "meaningful" });
  }
  return files;
}

function parsePatch(patch: string, files: ChangedFile[]): DiffHunk[] {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const hunks: DiffHunk[] = [];
  let currentFile: ChangedFile | undefined;
  let currentHunk: { fileId: string; oldStart: number; newStart: number; oldCursor: number; newCursor: number; lines: DiffLine[] } | undefined;

  const finishHunk = () => {
    if (currentHunk === undefined) return;
    const { oldCursor: _oldCursor, newCursor: _newCursor, ...hunk } = currentHunk;
    hunks.push({ ...hunk, id: stableId(`${hunk.fileId}:${hunk.oldStart}:${hunk.newStart}:${hunks.length}`) });
    currentHunk = undefined;
  };

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      finishHunk();
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      currentFile = match === null ? undefined : filesByPath.get(match[2]);
      continue;
    }
    if (currentFile === undefined) continue;
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      currentFile.binary = true;
      continue;
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header !== null) {
      finishHunk();
      const oldStart = Number(header[1]);
      const newStart = Number(header[2]);
      currentHunk = { fileId: currentFile.id, oldStart, newStart, oldCursor: oldStart, newCursor: newStart, lines: [] };
      continue;
    }
    if (currentHunk === undefined || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+")) {
      currentHunk.lines.push({ kind: "addition", content: line.slice(1), newLine: currentHunk.newCursor++ });
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ kind: "deletion", content: line.slice(1), oldLine: currentHunk.oldCursor++ });
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({ kind: "context", content: line.slice(1), oldLine: currentHunk.oldCursor++, newLine: currentHunk.newCursor++ });
    }
  }
  finishHunk();
  return hunks;
}

function classifyFile(path: string, binary: boolean): { signal: FileSignal; reason?: string } {
  const normalized = path.toLowerCase();
  if (binary) return { signal: "low-signal", reason: "Binary change" };
  if (/(^|\/)(node_modules|vendor|vendors|third_party|third-party)\//.test(normalized)) return { signal: "low-signal", reason: "Vendored dependency" };
  if (/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|podfile\.lock|cargo\.lock|package\.resolved)$/.test(normalized)) return { signal: "low-signal", reason: "Lockfile" };
  if (/(^|\/)(dist|build|coverage)\//.test(normalized) || /\.min\.(js|css)$/.test(normalized)) return { signal: "low-signal", reason: "Generated output" };
  return { signal: "meaningful" };
}

function statusFor(code: string): ChangedFile["status"] {
  const statuses: Record<string, ChangedFile["status"]> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied" };
  return statuses[code] ?? "unknown";
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
