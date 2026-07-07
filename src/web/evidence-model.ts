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
  let changed = lines
    .map((line, index) => ({ line, index, score: evidenceLineScore(line) }))
    .filter(({ line, score }) => line.kind !== "context" && score > 1)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 10)
    .sort((left, right) => left.index - right.index);
  // A hunk whose changed lines are all routine or import churn still deserves
  // a focused excerpt; fall back to its first changed lines rather than nothing.
  if (changed.length === 0) changed = lines.map((line, index) => ({ line, index, score: 1 })).filter(({ line }) => line.kind !== "context").slice(0, 6);
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

/** Definition-introducing words across mainstream languages (TS/JS, Python, Go, Rust, Ruby, Swift, Kotlin, Java, C#, Elixir, PHP...). */
const DEFINITION_WORDS = new Set(["function", "func", "fn", "fun", "def", "defp", "defmodule", "defmacro", "sub", "proc", "class", "struct", "enum", "union", "interface", "trait", "impl", "protocol", "extension", "module", "record", "typedef", "macro", "constructor", "init", "lambda"]);
/** Control-flow and effect words that usually carry the behavioral meaning of a change. */
const FLOW_WORDS = new Set(["return", "throw", "throws", "raise", "panic", "yield", "await", "defer", "break", "continue", "if", "elif", "elsif", "unless", "switch", "case", "match", "when", "guard", "for", "foreach", "while", "loop", "try", "catch", "except", "finally", "rescue", "ensure", "assert", "expect"]);
const IMPORT_LINE = /^(?:import\s|from\s+\S+\s+import\s|require\s*\(|require\s+['"]|include\s|#include\b|#import\b|using\s|use\s|package\s|namespace\s|extern\s+crate\s)/;
const COMMENT_LINE = /^(?:\/\/|\/\*|\*(?:\s|\/|$)|#(?!include|import|define|if|ifdef|ifndef|else|elif|endif|pragma|!)|--(?:\s|$)|;;)/;
const BLOCK_CLOSE = /^(?:end|fi|esac|done|endif|endfor|endwhile|endfunction|endmodule|endclass)[.;,]?$/i;

export function evidenceLineScore(line: DiffLine): number {
  if (line.kind === "context" || isRoutineLine(line.content)) return 0;
  const source = line.content.trim();
  if (IMPORT_LINE.test(source)) return 1;
  const words = source.toLowerCase().match(/[a-z_$][\w$]*/g) ?? [];
  if (COMMENT_LINE.test(source)) return /\b(?:TODO|FIXME|HACK|NOTE|WARNING|BUG|XXX)\b/.test(source) ? 4 : 2;
  let score = 10;
  if (words.some((word) => DEFINITION_WORDS.has(word))) score += 8;
  if (words.some((word) => FLOW_WORDS.has(word))) score += 6;
  if (/=>|->|:=|[A-Za-z_$][\w$]*\s*\(|[=!<>]=/.test(source)) score += 4;
  return score + Math.min(3, Math.floor(words.length / 5));
}

export function isRoutineLine(source: string): boolean {
  const line = source.trim();
  return line.length === 0
    || /^[{}[\]()`;,]+;?$/.test(line)
    || BLOCK_CLOSE.test(line)
    || /^(?:else|then|do|try|finally|begin)\s*[{:]?$/i.test(line)
    || /^['"`]{3}$/.test(line)
    || /^(?:get|set)\s+[A-Za-z_$][\w$]*\s*\(/.test(line)
    || /^(?:[A-Za-z_$][\w$]*\s+){0,3}[A-Za-z_$][\w$.]*[!?]?\s*(?::\s*[\w<>[\], .?|]+)?\s*:?=\s*(?:false|true|null|nil|none|undefined|0|0\.0|""|''|\[\]|\{\}|\(\))\s*[;,]?$/i.test(line);
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
