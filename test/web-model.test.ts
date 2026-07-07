import { describe, expect, it } from "vitest";
import type { AnalysisDocument } from "../src/shared/analysis-schema.js";
import type { ChangedFile, DiffHunk } from "../src/shared/domain.js";
import { attentionCounts, categoryCounts, chapterMetrics, evidenceLineScore, focusedEvidenceLines, isRoutineLine, isSupportingFile, linePrefix, toUnifiedDiff } from "../src/web/evidence-model.js";
import { resolveLanguage } from "../src/web/language.js";
import { buildTestThemes, deriveTestSummary, focusedTestLines, inferTestType, isTestPath, testTypeLabel } from "../src/web/test-plan-model.js";

describe("web evidence model", () => {
  it("selects meaningful changed lines with nearby non-routine context", () => {
    const lines: DiffHunk["lines"] = [
      { kind: "context", content: "export class Runner {", oldLine: 1, newLine: 1 },
      { kind: "addition", content: "  private ready = false;", newLine: 2 },
      { kind: "context", content: "", oldLine: 2, newLine: 3 },
      { kind: "addition", content: "  async run(job: Job) {", newLine: 4 },
      { kind: "addition", content: "    await this.execute(job);", newLine: 5 },
      { kind: "addition", content: "  }", newLine: 6 },
      { kind: "context", content: "}", oldLine: 3, newLine: 7 },
    ];

    expect(focusedEvidenceLines(lines).map(({ index }) => index)).toEqual([3, 4]);
  });

  it("scores load-bearing lines across languages and demotes import churn", () => {
    const python: DiffHunk["lines"] = [
      { kind: "addition", content: "import os", newLine: 1 },
      { kind: "addition", content: "from retries import backoff", newLine: 2 },
      { kind: "addition", content: "def run_job(job):", newLine: 4 },
      { kind: "addition", content: "    if job.cancelled:", newLine: 5 },
      { kind: "addition", content: "        raise JobCancelled(job.id)", newLine: 6 },
      { kind: "addition", content: "    return backoff(job.perform)", newLine: 7 },
    ];
    expect(focusedEvidenceLines(python).map(({ index }) => index)).toEqual([2, 3, 4, 5]);

    expect(evidenceLineScore({ kind: "addition", content: "func (r *Runner) Run(job Job) error {", newLine: 1 })).toBeGreaterThan(10);
    expect(evidenceLineScore({ kind: "addition", content: "    raise ValueError(reason)", newLine: 1 })).toBeGreaterThan(10);
    expect(evidenceLineScore({ kind: "addition", content: "use std::time::Duration;", newLine: 1 })).toBe(1);
    expect(evidenceLineScore({ kind: "addition", content: "#include <vector>", newLine: 1 })).toBe(1);
    expect(isRoutineLine("end")).toBe(true);
    expect(isRoutineLine("done")).toBe(true);
    expect(isRoutineLine("ready = False")).toBe(true);
  });

  it("falls back to the first changed lines when a hunk is import or boilerplate churn", () => {
    const lines: DiffHunk["lines"] = [
      { kind: "deletion", content: "import { old } from \"./old.js\";", oldLine: 1 },
      { kind: "addition", content: "import { replacement } from \"./replacement.js\";", newLine: 1 },
      { kind: "context", content: "export function unchanged() {}", oldLine: 2, newLine: 2 },
    ];
    expect(focusedEvidenceLines(lines).map(({ index }) => index)).toEqual([0, 1, 2]);
  });

  it("computes chapter metrics and counts without rendering HTML", () => {
    const document: AnalysisDocument = {
      summary: "Runner behavior changes.",
      chapters: [
        { id: "runner", title: "Runner", kind: "behavior", synopsis: "Runs jobs.", confidence: "high", attention: "contained", riskCategories: ["behavior"], evidenceIds: ["one", "two", "two"] },
        { id: "security", title: "Security", kind: "risk", synopsis: "Checks auth.", confidence: "medium", attention: "elevated", riskCategories: ["security"], evidenceIds: ["missing"] },
      ],
      steps: [{ id: "step-01", title: "Build runner", goal: "Introduce runner evidence.", youNowHave: "Runner evidence exists.", deferred: [], dependsOn: [], forwardRefs: {}, advancesChapterIds: ["runner"], evidenceIds: ["one"] }],
      omittedGroups: [],
      unclassifiedEvidenceIds: [],
    };
    const hunks: DiffHunk[] = [
      { id: "one", fileId: "source", oldStart: 1, newStart: 1, lines: [{ kind: "deletion", content: "old();", oldLine: 1 }, { kind: "addition", content: "next();", newLine: 1 }] },
      { id: "two", fileId: "test", oldStart: 2, newStart: 2, lines: [{ kind: "addition", content: "test('runs', () => {});", newLine: 2 }] },
    ];

    expect(chapterMetrics(document.chapters[0]!, hunks)).toEqual({ additions: 2, deletions: 1, files: 2, hunks: 2, addShare: 67, deleteShare: 33 });
    expect(attentionCounts(document)).toMatchObject({ contained: 1, elevated: 1, low: 0, high: 0, critical: 0 });
    expect(categoryCounts(document)).toEqual({ behavior: 1, security: 1 });
  });

  it("formats unified diff text and classifies support files deterministically", () => {
    const file: ChangedFile = { id: "source", path: "src\\runner.ts", status: "modified", binary: false, signal: "meaningful" };
    const hunk: DiffHunk = {
      id: "hunk",
      fileId: "source",
      oldStart: 10,
      newStart: 10,
      lines: [
        { kind: "context", content: "run();", oldLine: 10, newLine: 10 },
        { kind: "deletion", content: "old();", oldLine: 11 },
        { kind: "addition", content: "next();", newLine: 11 },
      ],
    };

    expect(linePrefix("addition")).toBe("+");
    expect(toUnifiedDiff(file, [hunk])).toMatchInlineSnapshot(`
      "diff --git a/src/runner.ts b/src/runner.ts
      --- a/src/runner.ts
      +++ b/src/runner.ts
      @@ -10,2 +10,2 @@
       run();
      -old();
      +next();"
    `);
    expect(isSupportingFile({ ...file, path: ".gitignore" })).toBe(true);
    expect(isSupportingFile({ ...file, signal: "low-signal" })).toBe(true);
    expect(isSupportingFile(file)).toBe(false);
  });
});

describe("web language model", () => {
  it("maps common file extensions to Shiki languages", () => {
    expect(resolveLanguage("src/page.ts")).toBe("typescript");
    expect(resolveLanguage("Component.TSX")).toBe("tsx");
    expect(resolveLanguage("script.zsh")).toBe("shellscript");
    expect(resolveLanguage("unknown.custom")).toBe("text");
  });
});

describe("web test plan model", () => {
  it("groups test chapters under matching story themes", () => {
    const document: AnalysisDocument = {
      summary: "Worktree review.",
      chapters: [
        { id: "worktree", title: "Worktree handling", kind: "behavior", synopsis: "Local changes are reviewed.", confidence: "high", attention: "contained", riskCategories: ["behavior"], evidenceIds: ["source"] },
        { id: "security", title: "Secret handling", kind: "risk", synopsis: "Secrets stay hidden.", confidence: "medium", attention: "elevated", riskCategories: ["security"], evidenceIds: ["security"] },
        { id: "tests", title: "Exercise worktree handling", kind: "test", synopsis: "Tests cover staged and unstaged files.", confidence: "high", attention: "low", riskCategories: ["behavior"], evidenceIds: ["test"] },
      ],
      steps: [{ id: "step-01", title: "Build worktree", goal: "Introduce worktree evidence.", youNowHave: "Worktree evidence exists.", deferred: [], dependsOn: [], forwardRefs: {}, advancesChapterIds: ["worktree"], evidenceIds: ["source"] }],
      omittedGroups: [],
      unclassifiedEvidenceIds: [],
    };
    const hunks: DiffHunk[] = [
      { id: "test", fileId: "test-file", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "test(\"includes staged and unstaged changes\", () => {});", newLine: 1 }] },
    ];
    const themes = buildTestThemes(document, hunks, new Map([["test-file", "test/git.test.ts"]]));

    expect(themes.map((theme) => ({ id: theme.id, caseNames: theme.cases.map((testCase) => testCase.name) }))).toEqual([
      { id: "worktree", caseNames: ["includes staged and unstaged changes"] },
    ]);
    expect(deriveTestSummary(themes)).toBe("Testing focused on Worktree handling. Most test activity was implemented in test/git.test.ts.");
    expect(testTypeLabel(themes[0]!.cases)).toBe("Unit");
  });

  it("infers test metadata and focused test lines without rendering", () => {
    const hunk: DiffHunk = {
      id: "hunk",
      fileId: "e2e",
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: "context", content: "describe('review', () => {", oldLine: 1, newLine: 1 },
        { kind: "addition", content: "  test('exports artifact', async () => {", newLine: 2 },
        { kind: "addition", content: "    await page.click('[data-action=export]');", newLine: 3 },
        { kind: "context", content: "});", oldLine: 2, newLine: 4 },
      ],
    };

    expect(isTestPath("test/page.test.ts")).toBe(true);
    expect(isTestPath("src/page.ts")).toBe(false);
    expect(inferTestType("e2e/review.playwright.ts")).toBe("End-to-end");
    expect(focusedTestLines(hunk, false).map((line) => line.content)).toEqual([
      "describe('review', () => {",
      "  test('exports artifact', async () => {",
      "    await page.click('[data-action=export]');",
    ]);
    expect(focusedTestLines(hunk, true)).toHaveLength(4);
  });
});
