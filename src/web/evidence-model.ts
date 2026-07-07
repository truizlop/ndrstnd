import type { AnalysisDocument } from "../shared/analysis-schema.js";
import type { ChangedFile, DiffHunk, DiffLine } from "../shared/domain.js";

export interface ChapterMetrics {
  additions: number;
  deletions: number;
  files: number;
  hunks: number;
  addShare: number;
  deleteShare: number;
}

export function chapterMetrics(chapter: AnalysisDocument["chapters"][number], hunks: DiffHunk[]): ChapterMetrics {
  const seen = new Set<string>();
  const chapterHunks = chapter.evidenceIds.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const hunk = hunks.find((candidate) => candidate.id === id);
    return hunk === undefined ? [] : [hunk];
  });
  const additions = chapterHunks.flatMap((hunk) => hunk.lines).filter((line) => line.kind === "addition").length;
  const deletions = chapterHunks.flatMap((hunk) => hunk.lines).filter((line) => line.kind === "deletion").length;
  const total = additions + deletions;
  const addShare = total === 0 ? 0 : Math.round((additions / total) * 100);
  return { additions, deletions, files: new Set(chapterHunks.map((hunk) => hunk.fileId)).size, hunks: chapterHunks.length, addShare, deleteShare: total === 0 ? 0 : 100 - addShare };
}

/**
 * Selects the lines the analysis marked as reviewer-critical for one hunk.
 * Deletion runs adjacent to a selected line stay visible so replaced code
 * keeps its before-image. Returns undefined when the ranges select nothing,
 * so callers can fall back to the heuristic selection.
 */
export function focusLinesFromRanges(lines: DiffLine[], ranges: Array<{ start: number; end: number }> | undefined): Array<{ line: DiffLine; index: number }> | undefined {
  if (ranges === undefined || ranges.length === 0) return undefined;
  const selected = new Set<number>();
  lines.forEach((line, index) => {
    if (line.newLine !== undefined && ranges.some((range) => line.newLine! >= range.start && line.newLine! <= range.end)) selected.add(index);
  });
  if (selected.size === 0) return undefined;
  let grew = true;
  while (grew) {
    grew = false;
    lines.forEach((line, index) => {
      if (line.kind === "deletion" && !selected.has(index) && (selected.has(index - 1) || selected.has(index + 1))) {
        selected.add(index);
        grew = true;
      }
    });
  }
  return [...selected].sort((left, right) => left - right).map((index) => ({ line: lines[index]!, index }));
}

export function focusedEvidenceLines(lines: DiffLine[]): Array<{ line: DiffLine; index: number }> {
  const changed = lines
    .map((line, index) => ({ line, index, score: evidenceLineScore(line) }))
    .filter(({ line, score }) => line.kind !== "context" && score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 10)
    .sort((left, right) => left.index - right.index);
  if (changed.length === 0) return [];

  const selected = new Set(changed.map(({ index }) => index));
  for (const { index } of changed) {
    for (const neighbour of [index - 1, index + 1]) {
      const line = lines[neighbour];
      if (line?.kind === "context" && !isRoutineLine(line.content)) selected.add(neighbour);
    }
  }
  return [...selected].sort((left, right) => left - right).map((index) => ({ line: lines[index]!, index }));
}

export function evidenceLineScore(line: DiffLine): number {
  if (line.kind === "context" || isRoutineLine(line.content)) return 0;
  const source = line.content.trim();
  let score = 10;
  if (/\b(?:export|function|class|interface|type|return|throw|await|if|switch|for|while|catch)\b/.test(source)) score += 8;
  if (/=>|\w+\s*\(/.test(source)) score += 4;
  if (/\b(?:TODO|FIXME|NOTE)\b/.test(source)) score += 2;
  return score;
}

export function isRoutineLine(source: string): boolean {
  const line = source.trim();
  return line.length === 0
    || /^[{}[\]();,]+$/.test(line)
    || /^(?:get|set)\s+[A-Za-z_$][\w$]*\s*\(/.test(line)
    || /^(?:constructor|init)\s*\([^)]*\)\s*\{\s*\}$/.test(line)
    || /^(?:(?:public|private|protected|readonly|static|declare|abstract|override)\s+)*(?:[A-Za-z_$][\w$]*[!?]?\s*(?::[^=;]+)?\s*=\s*(?:undefined|null|true|false|0|""|''|\[\]|\{\})\s*;?)$/.test(line);
}

export function isSupportingFile(file: ChangedFile | undefined): boolean {
  return file?.signal === "low-signal" || /(?:^|\/)(?:\.gitignore|license(?:\.[^/]+)?|readme(?:\.[^/]+)?)$/i.test(file?.path ?? "");
}

export function toUnifiedDiff(file: ChangedFile, hunks: DiffHunk[]): string {
  const path = file.path.replace(/\\/g, "/");
  const header = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  const blocks = hunks.map((hunk) => {
    const oldCount = hunk.lines.filter((line) => line.kind !== "addition").length;
    const newCount = hunk.lines.filter((line) => line.kind !== "deletion").length;
    return [`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`, ...hunk.lines.map((line) => `${linePrefix(line.kind)}${line.content}`)].join("\n");
  });
  return [...header, ...blocks].join("\n");
}

export function linePrefix(kind: DiffLine["kind"]): string {
  return kind === "addition" ? "+" : kind === "deletion" ? "-" : " ";
}

export function attentionCounts(document: AnalysisDocument): Record<string, number> {
  const counts: Record<string, number> = { low: 0, contained: 0, elevated: 0, high: 0, critical: 0 };
  for (const chapter of document.chapters) counts[chapter.attention] += 1;
  return counts;
}

export function categoryCounts(document: AnalysisDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const chapter of document.chapters) for (const category of chapter.riskCategories) counts[category] = (counts[category] ?? 0) + 1;
  return counts;
}

export function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}
