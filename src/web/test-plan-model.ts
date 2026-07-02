import type { AnalysisDocument } from "../shared/analysis-schema.js";
import type { DiffHunk } from "../shared/domain.js";
import { basename, focusedEvidenceLines } from "./evidence-model.js";

export interface TestCaseModel {
  id: string;
  name: string;
  filePath: string;
  hunk: DiffHunk;
  chapter: AnalysisDocument["chapters"][number];
}

export interface TestThemeModel {
  id: string;
  title: string;
  synopsis: string;
  storyClaims: AnalysisDocument["chapters"];
  testChapters: AnalysisDocument["chapters"];
  cases: TestCaseModel[];
}

export function buildTestThemes(document: AnalysisDocument, hunks: DiffHunk[], filePaths: Map<string, string>): TestThemeModel[] {
  const testChapters = document.chapters.filter((chapter) => chapter.kind === "test");
  const storyClaims = document.chapters.filter((chapter) => chapter.kind !== "test");
  const casesByChapter = new Map(testChapters.map((chapter) => [chapter.id, buildTestCases(chapter, hunks, filePaths)]));
  const fallbackClaims = storyClaims.length > 0 ? storyClaims : testChapters;
  if (fallbackClaims.length === 0) return [];
  return fallbackClaims.map((claim, index) => {
    const matchingTests = storyClaims.length === 1 ? testChapters : testChapters.filter((testChapter) => sharesAny(testChapter.riskCategories, claim.riskCategories));
    const selectedTests = matchingTests.length > 0 ? matchingTests : (index === 0 ? testChapters : []);
    const cases = selectedTests.flatMap((chapter) => casesByChapter.get(chapter.id) ?? []);
    return { id: claim.id, title: claim.title, synopsis: claim.synopsis, storyClaims: storyClaims.includes(claim) ? [claim] : [], testChapters: selectedTests, cases };
  }).filter((theme, index, all) => theme.cases.length > 0 || all.length === 1);
}

export function buildTestCases(chapter: AnalysisDocument["chapters"][number], hunks: DiffHunk[], filePaths: Map<string, string>): TestCaseModel[] {
  const evidence = chapter.evidenceIds.flatMap((id) => {
    const hunk = hunks.find((candidate) => candidate.id === id);
    return hunk === undefined ? [] : [hunk];
  });
  return evidence.flatMap((hunk) => {
    const filePath = filePaths.get(hunk.fileId) ?? hunk.fileId;
    const names = hunk.lines
      .filter((line) => line.kind === "addition")
      .map((line) => line.content.match(/(?:it|test|describe)\s*\(\s*["'`]([^"'`]+)/)?.[1])
      .filter((name): name is string => name !== undefined);
    return (names.length > 0 ? names : [`Verify ${basename(filePath)}`]).map((name, index) => ({ id: `${hunk.id}-${index}`, name, filePath, hunk, chapter }));
  });
}

export function deriveTestSummary(themes: TestThemeModel[]): string | undefined {
  const cases = themes.flatMap((theme) => theme.cases);
  if (cases.length === 0) return undefined;
  const themesWithCases = themes.filter((theme) => theme.cases.length > 0).map((theme) => theme.title);
  const topFile = mostCommon(cases.map((testCase) => testCase.filePath));
  return `Testing focused on ${listPhrase(themesWithCases.slice(0, 2))}. Most test activity was implemented in ${topFile}.`;
}

export function testTypeLabel(cases: TestCaseModel[]): string {
  if (cases.length === 0) return "Type unavailable";
  const labels = [...new Set(cases.map((testCase) => inferTestType(testCase.filePath)))];
  return labels.join(", ");
}

export function inferTestType(path: string): string {
  const lower = path.toLowerCase();
  if (/(e2e|end-to-end|playwright|cypress)/.test(lower)) return "End-to-end";
  if (/(integration|http|server)/.test(lower)) return "Integration";
  if (/(lint|eslint)/.test(lower)) return "Static analysis";
  if (/(typecheck|tsc)/.test(lower)) return "Type check";
  if (/(build)/.test(lower)) return "Build";
  return "Unit";
}

export function isTestPath(path: string): boolean {
  return /(?:^|\/)(?:test|tests|__tests__)\/|(?:\.test|\.spec)\.[^.]+$/i.test(path);
}

export function sharesAny(left: readonly string[], right: readonly string[]): boolean {
  return left.some((value) => right.includes(value));
}

export function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "test evidence";
}

export function listPhrase(values: string[]): string {
  if (values.length === 0) return "changed behavior";
  if (values.length === 1) return values[0]!;
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

export function focusedTestLines(hunk: DiffHunk, raw: boolean): DiffHunk["lines"] {
  const focused = focusedEvidenceLines(hunk.lines).map(({ line }) => line);
  return raw || focused.length === 0 ? hunk.lines : focused;
}
