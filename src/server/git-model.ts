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
  const filesByHeader = mapFilesByHeaderLine(files);
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
      currentFile = filesByHeader.get(line);
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
    const binary = binaryFileIds.has(file.id);
    const classification = classifyFile(file.path, binary);
    if (!binary && !hunkFileIds.has(file.id) && classification.signal === "meaningful") {
      return { ...file, binary, signal: "low-signal" as const, signalReason: hunklessReason(file.status) };
    }
    return { ...file, binary, signal: classification.signal, signalReason: classification.reason };
  });
}

function hunklessReason(status: ChangedFile["status"]): string {
  if (status === "renamed") return "Rename without content changes";
  if (status === "copied") return "Copy without content changes";
  return "No content changes";
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

/**
 * Git prints each `diff --git` header side raw or C-quoted depending on the path and core.quotePath,
 * and a raw path may itself contain ` b/`, so header lines cannot be split reliably. Matching whole
 * header lines precomputed from the known files sidesteps both ambiguities.
 */
function mapFilesByHeaderLine(files: readonly ChangedFile[]): Map<string, ChangedFile> {
  const byHeader = new Map<string, ChangedFile>();
  for (const file of files) {
    for (const oldSide of headerSideForms(`a/${file.previousPath ?? file.path}`)) {
      for (const newSide of headerSideForms(`b/${file.path}`)) {
        byHeader.set(`diff --git ${oldSide} ${newSide}`, file);
      }
    }
  }
  return byHeader;
}

function headerSideForms(side: string): Set<string> {
  return new Set([side, cQuote(side, true), cQuote(side, false)]);
}

const C_QUOTE_ESCAPES = new Map<number, string>([
  [0x07, "\\a"], [0x08, "\\b"], [0x09, "\\t"], [0x0a, "\\n"], [0x0b, "\\v"], [0x0c, "\\f"], [0x0d, "\\r"], [0x22, "\\\""], [0x5c, "\\\\"],
]);

function cQuote(side: string, quoteNonAscii: boolean): string {
  let quoted = "";
  let needsQuoting = false;
  for (const character of side) {
    const code = character.codePointAt(0) ?? 0;
    const escape = C_QUOTE_ESCAPES.get(code);
    if (escape !== undefined) {
      quoted += escape;
      needsQuoting = true;
    } else if (code < 0x20 || code === 0x7f) {
      quoted += octalEscape(code);
      needsQuoting = true;
    } else if (code > 0x7f && quoteNonAscii) {
      for (const byte of Buffer.from(character, "utf8")) quoted += octalEscape(byte);
      needsQuoting = true;
    } else {
      quoted += character;
    }
  }
  return needsQuoting ? `"${quoted}"` : side;
}

function octalEscape(byte: number): string {
  return `\\${byte.toString(8).padStart(3, "0")}`;
}
