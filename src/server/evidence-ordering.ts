import type { ChangedFile, DiffHunk } from "../shared/domain.js";

export interface EvidenceOrderConstraint {
  beforeEvidenceId: string;
  afterEvidenceId: string;
  reason: "symbol" | "layer" | "test";
  symbol?: string;
}

export interface EvidenceOrder {
  constraints: EvidenceOrderConstraint[];
  orderedEvidenceIds: string[];
}

const keywords = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function", "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "null", "of", "private", "protected", "public", "return", "static", "super", "switch", "this", "throw", "true", "try", "type", "undefined", "var", "void", "while",
]);

export function deriveEvidenceOrder(hunks: readonly DiffHunk[], files: readonly ChangedFile[]): EvidenceOrder {
  const filesById = new Map(files.map((file) => [file.id, file]));
  const meaningful = hunks.filter((hunk) => filesById.get(hunk.fileId)?.signal === "meaningful");
  const constraints = dedupeConstraints([
    ...symbolConstraints(meaningful),
    ...layerConstraints(meaningful, filesById),
    ...testConstraints(meaningful, filesById),
  ]);
  return {
    constraints,
    orderedEvidenceIds: topologicalEvidenceOrder(meaningful, constraints, filesById),
  };
}

export function topologicalEvidenceOrder(hunks: readonly DiffHunk[], constraints: readonly EvidenceOrderConstraint[], filesById: ReadonlyMap<string, ChangedFile>): string[] {
  const ids = hunks.map((hunk) => hunk.id);
  const known = new Set(ids);
  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const constraint of constraints) {
    if (!known.has(constraint.beforeEvidenceId) || !known.has(constraint.afterEvidenceId) || constraint.beforeEvidenceId === constraint.afterEvidenceId) continue;
    const edges = outgoing.get(constraint.beforeEvidenceId) ?? new Set<string>();
    if (!edges.has(constraint.afterEvidenceId)) {
      edges.add(constraint.afterEvidenceId);
      outgoing.set(constraint.beforeEvidenceId, edges);
      indegree.set(constraint.afterEvidenceId, (indegree.get(constraint.afterEvidenceId) ?? 0) + 1);
    }
  }

  const rank = new Map(hunks.map((hunk, index) => [hunk.id, evidenceRank(hunk, filesById, index)]));
  const ready = ids.filter((id) => indegree.get(id) === 0).sort((a, b) => compareRank(rank.get(a), rank.get(b)));
  const ordered: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(id);
    for (const after of outgoing.get(id) ?? []) {
      indegree.set(after, (indegree.get(after) ?? 0) - 1);
      if (indegree.get(after) === 0) {
        ready.push(after);
        ready.sort((a, b) => compareRank(rank.get(a), rank.get(b)));
      }
    }
  }
  return ordered.length === ids.length ? ordered : ids.sort((a, b) => compareRank(rank.get(a), rank.get(b)));
}

function symbolConstraints(hunks: readonly DiffHunk[]): EvidenceOrderConstraint[] {
  const bySymbol = new Map<string, Set<string>>();
  const usesByHunk = new Map<string, Set<string>>();
  for (const hunk of hunks) {
    const additions = hunk.lines.filter((line) => line.kind === "addition").map((line) => line.content);
    for (const symbol of additions.flatMap(definedSymbols)) {
      const definers = bySymbol.get(symbol) ?? new Set<string>();
      definers.add(hunk.id);
      bySymbol.set(symbol, definers);
    }
    usesByHunk.set(hunk.id, new Set(additions.flatMap(usedSymbols)));
  }

  const constraints: EvidenceOrderConstraint[] = [];
  for (const [hunkId, uses] of usesByHunk) {
    for (const symbol of uses) {
      for (const definerId of bySymbol.get(symbol) ?? []) {
        if (definerId !== hunkId) constraints.push({ beforeEvidenceId: definerId, afterEvidenceId: hunkId, reason: "symbol", symbol });
      }
    }
  }
  return constraints;
}

function layerConstraints(hunks: readonly DiffHunk[], filesById: ReadonlyMap<string, ChangedFile>): EvidenceOrderConstraint[] {
  const constraints: EvidenceOrderConstraint[] = [];
  for (const before of hunks) {
    for (const after of hunks) {
      if (before.id === after.id) continue;
      const beforeLayer = layerFor(filesById.get(before.fileId)?.path ?? "");
      const afterLayer = layerFor(filesById.get(after.fileId)?.path ?? "");
      if (beforeLayer < afterLayer) constraints.push({ beforeEvidenceId: before.id, afterEvidenceId: after.id, reason: "layer" });
    }
  }
  return constraints;
}

function testConstraints(hunks: readonly DiffHunk[], filesById: ReadonlyMap<string, ChangedFile>): EvidenceOrderConstraint[] {
  const constraints: EvidenceOrderConstraint[] = [];
  for (const implementation of hunks) {
    const implementationPath = filesById.get(implementation.fileId)?.path ?? "";
    if (isTestPath(implementationPath)) continue;
    for (const test of hunks) {
      const testPath = filesById.get(test.fileId)?.path ?? "";
      if (implementation.id !== test.id && isTestPath(testPath)) constraints.push({ beforeEvidenceId: implementation.id, afterEvidenceId: test.id, reason: "test" });
    }
  }
  return constraints;
}

function definedSymbols(line: string): string[] {
  const symbols: string[] = [];
  const patterns = [
    /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:default\s+)?(?:abstract\s+)?(?:class|interface|enum|type)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) symbols.push(match[1]);
  }
  return symbols;
}

function usedSymbols(line: string): string[] {
  return [...line.matchAll(/\b[A-Za-z_$][\w$]*\b/g)]
    .map((match) => match[0])
    .filter((word) => !keywords.has(word) && !/^[A-Z_]+$/.test(word));
}

function layerFor(path: string): number {
  if (isTestPath(path)) return 3;
  if (/(^|\/)(shared|types|models|domain|schema)(\/|\.)/.test(path)) return 0;
  if (/(^|\/)(server|api|services|core|lib)(\/|\.)/.test(path)) return 1;
  return 2;
}

function isTestPath(path: string): boolean {
  return /(^|\/)(?:test|tests|__tests__)\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function evidenceRank(hunk: DiffHunk, filesById: ReadonlyMap<string, ChangedFile>, index: number) {
  const path = filesById.get(hunk.fileId)?.path ?? hunk.fileId;
  return { layer: layerFor(path), path, newStart: hunk.newStart, index };
}

function compareRank(left: ReturnType<typeof evidenceRank> | undefined, right: ReturnType<typeof evidenceRank> | undefined): number {
  if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? 1 : -1;
  return left.layer - right.layer || left.path.localeCompare(right.path) || left.newStart - right.newStart || left.index - right.index;
}

function dedupeConstraints(constraints: EvidenceOrderConstraint[]): EvidenceOrderConstraint[] {
  const seen = new Set<string>();
  return constraints.filter((constraint) => {
    const key = `${constraint.beforeEvidenceId}\0${constraint.afterEvidenceId}\0${constraint.reason}\0${constraint.symbol ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
