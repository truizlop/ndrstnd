import { createHash } from "node:crypto";
import type { ChangedFile, DiffHunk, DiffLine, FileSignal } from "../shared/domain.js";

export interface ParsedPatch {
  hunks: DiffHunk[];
  binaryFileIds: Set<string>;
}

export function parseNameStatus(output: string): ChangedFile[] {
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

export function parsePatch(patch: string, files: readonly ChangedFile[]): ParsedPatch {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const hunks: DiffHunk[] = [];
  const binaryFileIds = new Set<string>();
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
      binaryFileIds.add(currentFile.id);
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
  return { hunks, binaryFileIds };
}

export function untrackedFiles(paths: readonly string[], knownFiles: readonly ChangedFile[]): ChangedFile[] {
  const knownPaths = new Set(knownFiles.map((file) => file.path));
  return paths.flatMap((path) => knownPaths.has(path) ? [] : [{ id: stableId(path), path, status: "added" as const, binary: false, signal: "meaningful" as const }]);
}

export function finalizeFiles(files: readonly ChangedFile[], hunks: readonly DiffHunk[], binaryFileIds: ReadonlySet<string>): ChangedFile[] {
  const hunkFileIds = new Set(hunks.map((hunk) => hunk.fileId));
  return files.map((file) => {
    const binary = binaryFileIds.has(file.id) || (!hunkFileIds.has(file.id) && !file.binary);
    const classification = classifyFile(file.path, binary);
    return { ...file, binary, signal: classification.signal, signalReason: classification.reason };
  });
}

export function classifyFile(path: string, binary: boolean): { signal: FileSignal; reason?: string } {
  const normalized = path.toLowerCase();
  if (binary) return { signal: "low-signal", reason: "Binary change" };
  if (/(^|\/)(node_modules|vendor|vendors|third_party|third-party)\//.test(normalized)) return { signal: "low-signal", reason: "Vendored dependency" };
  if (/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|podfile\.lock|cargo\.lock|package\.resolved)$/.test(normalized)) return { signal: "low-signal", reason: "Lockfile" };
  if (/(^|\/)(dist|build|coverage)\//.test(normalized) || /\.min\.(js|css)$/.test(normalized)) return { signal: "low-signal", reason: "Generated output" };
  return { signal: "meaningful" };
}

export function statusFor(code: string): ChangedFile["status"] {
  const statuses: Record<string, ChangedFile["status"]> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied" };
  return statuses[code] ?? "unknown";
}

export function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
