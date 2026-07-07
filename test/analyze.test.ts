import { describe, expect, it } from "vitest";
import { analysisPrompt, buildPromptReviewInput, extractJson, parseAnalysisDocument } from "../src/server/analysis-core.js";
import type { CollectedReviewInput } from "../src/server/git.js";

const input: CollectedReviewInput = {
  repoPath: "/repo", targetRef: "agent", baseRef: "main", mergeBase: "base",
  files: [
    { id: "source", path: "app.ts", status: "modified", binary: false, signal: "meaningful" },
    { id: "lock", path: "package-lock.json", status: "modified", binary: false, signal: "low-signal", signalReason: "Lockfile" },
  ],
  hunks: [
    { id: "source-hunk", fileId: "source", oldStart: 1, newStart: 1, lines: [] },
    { id: "lock-hunk", fileId: "lock", oldStart: 1, newStart: 1, lines: [] },
  ],
};

const validSummary = "The branch teaches the runner to execute submitted jobs through one explicit path and to report results to callers, while tests pin the new execution behavior. Reviewers should start at the runner entry point because every other change in the branch supports that flow.";
const validSynopsis = "The runner now executes submitted jobs through a single entry point, which changes how callers observe completion, results, and failures during a run.";

const sourceStep = {
  id: "step-01",
  title: "Build runner behavior",
  goal: "Introduce the runner execution path so a submitted job flows through one explicit entry point and reports its result.",
  youNowHave: "The runner accepts a job, awaits its execution, and returns the job identifier to the caller once the run completes.",
  deferred: [],
  dependsOn: [],
  forwardRefs: {},
  advancesChapterIds: ["one"],
  evidenceIds: ["source-hunk"],
};

describe("analysis documents", () => {
  it("grounds the step plan with define-before-use hints and a suggested order in the manifest", () => {
    const orderedInput: CollectedReviewInput = {
      ...input,
      files: [
        { id: "def-file", path: "src/server/run.ts", status: "modified", binary: false, signal: "meaningful" },
        { id: "use-file", path: "src/web/call.ts", status: "modified", binary: false, signal: "meaningful" },
      ],
      hunks: [
        { id: "use-hunk", fileId: "use-file", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "call(runJob());", newLine: 1 }] },
        { id: "def-hunk", fileId: "def-file", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "export function runJob() { return true; }", newLine: 1 }] },
      ],
    };

    const manifest = buildPromptReviewInput(orderedInput);

    expect(manifest.construction.defineBeforeUse).toContainEqual({ symbol: "runJob", definedIn: "def-hunk", usedIn: "use-hunk" });
    expect(manifest.construction.suggestedEvidenceOrder.indexOf("def-hunk")).toBeLessThan(manifest.construction.suggestedEvidenceOrder.indexOf("use-hunk"));
    expect(analysisPrompt(orderedInput)).toContain("construction.defineBeforeUse");
  });

  it("rejects fabricated evidence", () => {
    expect(() => parseAnalysisDocument({ summary: "x", chapters: [{ id: "one", title: "x", kind: "other", synopsis: "x", confidence: "low", attention: "low", riskCategories: [], evidenceIds: ["not-real"] }], steps: [sourceStep], omittedGroups: [], unclassifiedEvidenceIds: [] }, input)).toThrow("unknown evidence");
  });

  it("rejects a document that leaves meaningful evidence unclassified", () => {
    expect(() => parseAnalysisDocument({ summary: "x", chapters: [], steps: [], omittedGroups: [], unclassifiedEvidenceIds: [] }, input)).toThrow("did not account");
  });

  it("rejects low-signal evidence left in unclassified instead of an omitted group", () => {
    const chapter = { id: "one", title: "Runner behavior", kind: "behavior" as const, synopsis: validSynopsis, confidence: "high" as const, attention: "contained" as const, riskCategories: ["behavior" as const], evidenceIds: ["source-hunk"] };
    expect(() => parseAnalysisDocument({ summary: validSummary, chapters: [chapter], steps: [sourceStep], omittedGroups: [], unclassifiedEvidenceIds: ["lock-hunk"] }, input)).toThrow("Low-signal evidence was left ungrouped");
    expect(() => parseAnalysisDocument({ summary: validSummary, chapters: [chapter], steps: [sourceStep], omittedGroups: [], unclassifiedEvidenceIds: [] }, input)).toThrow("Low-signal evidence was left ungrouped");
    expect(analysisPrompt(input)).toContain("Group every low-signal evidence ID into an omitted group in o");
  });

  it("round-trips a valid step plan through document parsing", () => {
    expect(parseAnalysisDocument({
      summary: validSummary,
      chapters: [{ id: "one", title: "Runner behavior", kind: "behavior", synopsis: validSynopsis, confidence: "high", attention: "contained", riskCategories: ["behavior"], evidenceIds: ["source-hunk"] }],
      steps: [sourceStep],
      omittedGroups: [["Low-signal changes", "Lockfile evidence is grouped.", ["lock-hunk"]]].map(([title, reason, evidenceIds]) => ({ title, reason, evidenceIds })) as Array<{ title: string; reason: string; evidenceIds: string[] }>,
      unclassifiedEvidenceIds: [],
    }, input).steps).toEqual([sourceStep]);
  });

  it("rejects shallow one-line prose with a self-fixing word range", () => {
    expect(() => parseAnalysisDocument({
      summary: validSummary,
      chapters: [{ id: "one", title: "Runner behavior", kind: "behavior", synopsis: "Runner behavior changes.", confidence: "high", attention: "contained", riskCategories: ["behavior"], evidenceIds: ["source-hunk"] }],
      steps: [sourceStep],
      omittedGroups: [{ title: "Low-signal changes", reason: "Lockfile evidence is grouped.", evidenceIds: ["lock-hunk"] }],
      unclassifiedEvidenceIds: [],
    }, input)).toThrow("Chapter one synopsis is 3 words but must be 20-55");
  });

  it("rejects missing or duplicated step evidence", () => {
    const chapter = { id: "one", title: "Runner behavior", kind: "behavior" as const, synopsis: "Runner behavior changes.", confidence: "high" as const, attention: "contained" as const, riskCategories: ["behavior" as const], evidenceIds: ["source-hunk"] };
    expect(() => parseAnalysisDocument({ summary: "x", chapters: [chapter], steps: [], omittedGroups: [{ title: "Low", reason: "Lockfile.", evidenceIds: ["lock-hunk"] }], unclassifiedEvidenceIds: [] }, input)).toThrow("steps did not account");
    expect(() => parseAnalysisDocument({ summary: "x", chapters: [chapter], steps: [sourceStep, { ...sourceStep, id: "step-02" }], omittedGroups: [{ title: "Low", reason: "Lockfile.", evidenceIds: ["lock-hunk"] }], unclassifiedEvidenceIds: [] }, input)).toThrow("duplicated");
  });

  it("rejects def-before-use violations unless a forward reference declares the symbol", () => {
    const orderedInput: CollectedReviewInput = {
      ...input,
      files: [
        { id: "def-file", path: "src/server/run.ts", status: "modified", binary: false, signal: "meaningful" },
        { id: "use-file", path: "src/server/call.ts", status: "modified", binary: false, signal: "meaningful" },
      ],
      hunks: [
        { id: "use-hunk", fileId: "use-file", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "call(runJob());", newLine: 1 }] },
        { id: "def-hunk", fileId: "def-file", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "export function runJob() { return true; }", newLine: 1 }] },
      ],
    };
    const chapter = { id: "one", title: "Runner behavior", kind: "behavior" as const, synopsis: validSynopsis, confidence: "high" as const, attention: "contained" as const, riskCategories: ["behavior" as const], evidenceIds: ["use-hunk", "def-hunk"] };
    const useStep = { ...sourceStep, id: "step-01", title: "Call runner", advancesChapterIds: ["one"], evidenceIds: ["use-hunk"] };
    const defStep = { ...sourceStep, id: "step-02", title: "Define runner", dependsOn: ["step-01"], advancesChapterIds: ["one"], evidenceIds: ["def-hunk"] };
    const document = { summary: validSummary, chapters: [chapter], steps: [useStep, defStep], omittedGroups: [], unclassifiedEvidenceIds: [] };

    expect(() => parseAnalysisDocument(document, orderedInput)).toThrow("violates symbol runJob");
    expect(parseAnalysisDocument({ ...document, steps: [{ ...useStep, forwardRefs: { runJob: "step-02" } }, defStep] }, orderedInput).steps[0].forwardRefs).toEqual({ runJob: "step-02" });
  });

  it("accepts compact Codex output and normalizes it to the presentation document", () => {
    expect(parseAnalysisDocument({
      s: validSummary,
      c: [[
        "one",
        "Runner behavior",
        "behavior",
        validSynopsis,
        "The entry point accepted no jobs, so callers had no way to run work or observe results.",
        "Callers can run jobs through the runner and receive the completed job identifier when execution finishes.",
        "high",
        "contained",
        ["behavior"],
        ["source-hunk"],
      ]],
      t: [[
        "step-01",
        "Build runner behavior",
        sourceStep.goal,
        sourceStep.youNowHave,
        [],
        [],
        {},
        ["one"],
        ["source-hunk"],
      ]],
      o: [["Low-signal changes", "Lockfile evidence is grouped.", ["lock-hunk"]]],
      u: [],
    }, input)).toMatchObject({
      summary: validSummary,
      chapters: [{ id: "one", title: "Runner behavior", evidenceIds: ["source-hunk"] }],
      omittedGroups: [{ title: "Low-signal changes", evidenceIds: ["lock-hunk"] }],
    });
  });

  it("rejects overly verbose Codex prose before it reaches the artifact", () => {
    expect(() => parseAnalysisDocument({
      summary: "summary",
      chapters: [{
        id: "one",
        title: "Runner behavior",
        kind: "behavior",
        synopsis: "word ".repeat(100),
        confidence: "high",
        attention: "contained",
        riskCategories: ["behavior"],
        evidenceIds: ["source-hunk"],
      }],
      steps: [sourceStep],
      omittedGroups: [{ title: "Low-signal changes", reason: "Lockfile evidence is grouped.", evidenceIds: ["lock-hunk"] }],
      unclassifiedEvidenceIds: [],
    }, input)).toThrow();
  });

  it("builds a compact reference-first prompt instead of embedding the full patch", () => {
    const largeInput: CollectedReviewInput = {
      ...input,
      files: [{ id: "source", path: "src/large.ts", status: "modified", binary: false, signal: "meaningful" }],
      hunks: Array.from({ length: 24 }, (_, hunkIndex) => ({
        id: `hunk-${hunkIndex}`,
        fileId: "source",
        oldStart: hunkIndex * 20 + 1,
        newStart: hunkIndex * 20 + 1,
        lines: Array.from({ length: 40 }, (_, lineIndex) => ({
          kind: lineIndex % 3 === 0 ? "addition" as const : lineIndex % 3 === 1 ? "deletion" as const : "context" as const,
          content: `const generatedValue${hunkIndex}_${lineIndex} = "${"full patch content ".repeat(8)}";`,
          oldLine: lineIndex % 3 === 0 ? undefined : hunkIndex * 20 + lineIndex,
          newLine: lineIndex % 3 === 1 ? undefined : hunkIndex * 20 + lineIndex,
        })),
      })),
    };
    const legacyReviewInput = JSON.stringify({
      target: largeInput.targetRef,
      mergeBase: largeInput.mergeBase,
      files: largeInput.files,
      evidence: largeInput.hunks.map((hunk) => ({ id: hunk.id, path: largeInput.files.find((file) => file.id === hunk.fileId)?.path, lines: hunk.lines })).slice(0, 120),
    });

    const prompt = analysisPrompt(largeInput);

    expect(prompt).toContain("compact manifest");
    expect(prompt.length).toBeLessThan(legacyReviewInput.length / 2);
  });

  it("uses worktree-inclusive inspection commands when dirty changes are part of the review", () => {
    const manifest = buildPromptReviewInput({ ...input, includesWorkingTree: true });

    expect(manifest.inspection.summaryCommand).toBe("git diff --stat --find-renames --find-copies main");
    expect(manifest.inspection.patchCommand).toBe("git diff --no-ext-diff --unified=80 --find-renames --find-copies main -- <path>");
  });

  it("asks for compact output that is materially smaller than the full document shape", () => {
    const compactDocument = {
      s: "Runner behavior and tests are now easier to understand.",
      c: Array.from({ length: 6 }, (_, index) => [`chapter-${index}`, "Runner behavior", "behavior", "The runner delegates jobs through execution.", "The entry point did not run jobs.", "Callers receive execution results.", "high", "contained", ["behavior"], [`hunk-${index}`]]),
      t: Array.from({ length: 6 }, (_, index) => [`step-${index}`, "Build runner", "The runner increment is introduced.", "The runner increment now exists.", [], index === 0 ? [] : [`step-${index - 1}`], {}, [`chapter-${index}`], [`hunk-${index}`]]),
      o: [["Low-signal changes", "Lockfile evidence is grouped.", ["lock-hunk"]]],
      u: [],
    };
    const fullDocument = {
      summary: compactDocument.s,
      chapters: compactDocument.c.map((chapter) => ({
        id: chapter[0],
        title: chapter[1],
        kind: chapter[2],
        synopsis: chapter[3],
        before: chapter[4],
        after: chapter[5],
        confidence: chapter[6],
        attention: chapter[7],
        riskCategories: chapter[8],
        evidenceIds: chapter[9],
      })),
      steps: compactDocument.t.map((step) => ({
        id: step[0],
        title: step[1],
        goal: step[2],
        youNowHave: step[3],
        deferred: step[4],
        dependsOn: step[5],
        forwardRefs: step[6],
        advancesChapterIds: step[7],
        evidenceIds: step[8],
      })),
      omittedGroups: compactDocument.o.map((group) => ({ title: group[0], reason: group[1], evidenceIds: group[2] })),
      unclassifiedEvidenceIds: compactDocument.u,
    };

    expect(analysisPrompt(input)).toContain("{s,c:[[id,title,kind,synopsis,before|null,after|null,confidence,attention,riskCategories,evidenceIds]],t:[[id,title,goal,youNowHave,[[concern,resolvedByStepId|null]],dependsOn,forwardRefs,advancesChapterIds,evidenceIds]],o:[[title,reason,evidenceIds]],u:[evidenceId]}");
    expect(JSON.stringify(compactDocument).length).toBeLessThan(JSON.stringify(fullDocument).length * 0.7);
  });

  it("extracts the JSON document from narrated or fenced responses", () => {
    expect(extractJson('{"s":"ok"}')).toBe('{"s":"ok"}');
    expect(extractJson('I will inspect the repo first.\n\n```json\n{"s":"ok"}\n```\nDone.')).toBe('{"s":"ok"}');
    expect(extractJson('I inspected the branch and here is the document: {"s":"ok"} — let me know.')).toBe('{"s":"ok"}');
    expect(extractJson("no json here")).toBe("no json here");
  });

  it("reports every shallow field in one validation error", () => {
    expect(() => parseAnalysisDocument({
      summary: validSummary,
      chapters: [{ id: "one", title: "Runner behavior", kind: "behavior", synopsis: "Runner behavior changes.", confidence: "high", attention: "contained", riskCategories: ["behavior"], evidenceIds: ["source-hunk"] }],
      steps: [{ ...sourceStep, goal: "Too short." }],
      omittedGroups: [{ title: "Low-signal changes", reason: "Lockfile evidence is grouped.", evidenceIds: ["lock-hunk"] }],
      unclassifiedEvidenceIds: [],
    }, input)).toThrow(/Chapter one synopsis is 3 words but must be 20-55.*Step step-01 goal is 2 words but must be 12-40/);
  });

  it("caps conversation text in the prompt manifest", () => {
    const manifest = buildPromptReviewInput(input, {
      source: "markdown",
      messages: [
        { role: "user", text: "first message" },
        { role: "assistant", text: "implementation detail ".repeat(1_000) },
      ],
    });

    expect(manifest.conversation?.messageCount).toBe(2);
    expect(manifest.conversation?.excerptedMessages.at(-1)?.excerpt.length).toBeLessThan(1_600);
  });
});
