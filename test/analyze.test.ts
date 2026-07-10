import { describe, expect, it } from "vitest";
import { INLINE_PATCH_BUDGET, PROSE_WORD_RANGES, analysisPrompt, buildPromptReviewInput, extractJson, parseAnalysisDocument } from "../src/server/analysis-core.js";
import { analyzeWithAgent, analysisRepairPrompt, formatAnalysisHeartbeat, parseAnalysisResponse } from "../src/server/analyze.js";
import type { ReviewAgent } from "../src/server/agent.js";
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
  it("reports the failed response phase without exposing the response body", () => {
    let message = "";
    try {
      parseAnalysisResponse("{\"s\":] secret source code", input);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/JSON parsing failed:.*Response metadata: response 25 characters/);
    expect(message).not.toContain("secret source code");
  });

  it("distinguishes wire-shape errors from review invariant errors", () => {
    expect(() => parseAnalysisResponse(JSON.stringify({ s: "x", c: [["one", "title", "test", "synopsis", null, null, "high", "low", ["test"], ["source-hunk"]]], t: [], o: [], u: [] }), input))
      .toThrow("wire document validation failed");
    expect(() => parseAnalysisResponse(JSON.stringify({
      summary: validSummary,
      chapters: [{ id: "one", title: "Runner behavior", kind: "behavior", synopsis: validSynopsis, confidence: "high", attention: "contained", riskCategories: ["behavior"], evidenceIds: ["not-real"] }],
      steps: [sourceStep], omittedGroups: [{ title: "Low-signal changes", reason: "Lockfile evidence is grouped.", evidenceIds: ["lock-hunk"] }], unclassifiedEvidenceIds: [],
    }), input)).toThrow(/review invariant validation failed: Analysis referenced unknown evidence: not-real/);
  });

  it("repairs a malformed first response and accepts the corrected document", async () => {
    const responses = ["{\"s\":]", JSON.stringify({
      s: validSummary,
      c: [["one", "Runner behavior", "behavior", validSynopsis, null, null, "high", "contained", ["behavior"], ["source-hunk"]]],
      t: [["step-01", "Build runner behavior", sourceStep.goal, sourceStep.youNowHave, [], [], {}, ["one"], ["source-hunk"]]],
      o: [["Low-signal changes", "Lockfile evidence is grouped.", ["lock-hunk"]]],
      u: [],
    })];
    const repairPrompts: string[] = [];
    const agent = {
      id: "codex",
      name: "Codex",
      command: "codex",
      loginArgs: [],
      homeDirectory: () => "/tmp",
      getAuthStatus: async () => ({ state: "signed-in", accountType: "test" }),
      createClient: () => ({
        startTextThread: async () => ({
          send: async (prompt: string) => {
            repairPrompts.push(prompt);
            return responses.shift()!;
          },
          close: async () => undefined,
        }),
        close: () => undefined,
      }),
    } as ReviewAgent;

    const document = await analyzeWithAgent(agent, input);
    expect(document.summary).toBe(validSummary);
    expect(repairPrompts).toHaveLength(2);
    expect(repairPrompts[1]).toContain("position 3 is kind");
    expect(repairPrompts[1]).toContain("position 9 is riskCategories");
  });

  it("keeps the repair prompt explicit about the compact tuple contract", () => {
    const prompt = analysisRepairPrompt("c.0.8.0: Invalid enum value");
    expect(prompt).toContain("return only one valid minified JSON object");
    expect(prompt).toContain("position 3 is kind");
    expect(prompt).toContain("position 9 is riskCategories");
  });

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

  it("states the same prose word ranges the validator enforces", () => {
    const prompt = analysisPrompt(input);
    expect(prompt).toContain(`summary ${PROSE_WORD_RANGES.summary.min}-${PROSE_WORD_RANGES.summary.max} words`);
    expect(prompt).toContain(`before and after ${PROSE_WORD_RANGES.beforeAfter.min}-${PROSE_WORD_RANGES.beforeAfter.max} words`);
  });

  it("tells Codex to ground the narrative in a supplied conversation", () => {
    expect(analysisPrompt(input)).toContain("Treat it as primary evidence of intent");
    expect(analysisPrompt(input)).toContain("never copy credentials or secrets");
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

  it("reports the matching shape's validation error for a near-valid full document", () => {
    let message = "";
    try {
      parseAnalysisDocument({
        summary: validSummary,
        chapters: [{ id: "one", title: "Runner behavior", kind: "behavior", synopsis: validSynopsis, confidence: "high", attention: "medium", riskCategories: ["behavior"], evidenceIds: ["source-hunk"] }],
        steps: [sourceStep],
        omittedGroups: [{ title: "Low-signal changes", reason: "Lockfile evidence is grouped.", evidenceIds: ["lock-hunk"] }],
        unclassifiedEvidenceIds: [],
      }, input);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("full shape");
    expect(message).toContain("chapters.0.attention");
    expect(message).not.toContain("s: Required");
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

  it("rejects evidence classified more than once and duplicate chapter or step ids", () => {
    const chapter = { id: "one", title: "Runner behavior", kind: "behavior" as const, synopsis: validSynopsis, confidence: "high" as const, attention: "contained" as const, riskCategories: ["behavior" as const], evidenceIds: ["source-hunk"] };
    const omittedGroups = [{ title: "Low-signal changes", reason: "Lockfile evidence is grouped.", evidenceIds: ["lock-hunk"] }];

    expect(() => parseAnalysisDocument({ summary: validSummary, chapters: [chapter], steps: [sourceStep], omittedGroups, unclassifiedEvidenceIds: ["source-hunk"] }, input))
      .toThrow("Analysis evidence was classified more than once: source-hunk");
    expect(() => parseAnalysisDocument({ summary: validSummary, chapters: [chapter, { ...chapter, evidenceIds: ["lock-hunk"] }], steps: [sourceStep], omittedGroups, unclassifiedEvidenceIds: [] }, input))
      .toThrow("Analysis chapter ids are duplicated: one");
    expect(() => parseAnalysisDocument({ summary: validSummary, chapters: [chapter], steps: [sourceStep, { ...sourceStep, evidenceIds: ["lock-hunk"] }], omittedGroups, unclassifiedEvidenceIds: [] }, input))
      .toThrow("Analysis step ids are duplicated: step-01");
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
    const document = { summary: validSummary, chapters: [chapter], steps: [useStep, defStep], omittedGroups: [], unclassifiedEvidenceIds: [], focus: { "use-hunk": [{ start: 1, end: 1 }], "def-hunk": [{ start: 1, end: 1 }] } };

    expect(() => parseAnalysisDocument(document, orderedInput)).toThrow("violates symbol runJob");
    expect(parseAnalysisDocument({ ...document, steps: [{ ...useStep, forwardRefs: { runJob: "step-02" } }, defStep] }, orderedInput).steps[0].forwardRefs).toEqual({ runJob: "step-02" });
  });

  it("validates focus ranges and requires focus for chapter evidence", () => {
    const focusInput: CollectedReviewInput = {
      ...input,
      files: [{ id: "source", path: "app.ts", status: "modified", binary: false, signal: "meaningful" }],
      hunks: [{
        id: "source-hunk", fileId: "source", oldStart: 8, newStart: 8,
        lines: [
          { kind: "context", content: "export class Runner {", oldLine: 8, newLine: 8 },
          { kind: "deletion", content: "  run() { return null; }", oldLine: 9 },
          { kind: "addition", content: "  run(job) { return this.execute(job); }", newLine: 9 },
          { kind: "addition", content: "}", newLine: 10 },
        ],
      }],
    };
    const chapter = { id: "one", title: "Runner behavior", kind: "behavior" as const, synopsis: validSynopsis, confidence: "high" as const, attention: "contained" as const, riskCategories: ["behavior" as const], evidenceIds: ["source-hunk"] };
    const document = { summary: validSummary, chapters: [chapter], steps: [sourceStep], omittedGroups: [], unclassifiedEvidenceIds: [] };

    expect(() => parseAnalysisDocument(document, focusInput)).toThrow("Focus is missing for chapter evidence: source-hunk");
    expect(() => parseAnalysisDocument({ ...document, focus: { "source-hunk": [{ start: 40, end: 50 }] } }, focusInput)).toThrow("selects no lines of that hunk; its new-file lines span 8-10");
    expect(() => parseAnalysisDocument({ ...document, focus: { "source-hunk": [{ start: 10, end: 9 }] } }, focusInput)).toThrow("inverted");
    expect(() => parseAnalysisDocument({ ...document, focus: { "source-hunk": [{ start: 9, end: 9 }], "not-real": [{ start: 1, end: 1 }] } }, focusInput)).toThrow("Focus referenced unknown evidence");
    expect(parseAnalysisDocument({ ...document, focus: { "source-hunk": [{ start: 9, end: 9 }] } }, focusInput).focus).toEqual({ "source-hunk": [{ start: 9, end: 9 }] });
    expect(analysisPrompt(focusInput)).toContain("f drives the Evidence zoom excerpts");
  });

  it("salvages valid focus and tolerates missing focus on the final repair attempt", () => {
    const focusInput: CollectedReviewInput = {
      ...input,
      files: [{ id: "source", path: "app.ts", status: "modified", binary: false, signal: "meaningful" }],
      hunks: [{
        id: "source-hunk", fileId: "source", oldStart: 8, newStart: 8,
        lines: [{ kind: "addition", content: "run(job) { return this.execute(job); }", newLine: 9 }],
      }],
    };
    const chapter = { id: "one", title: "Runner behavior", kind: "behavior" as const, synopsis: validSynopsis, confidence: "high" as const, attention: "contained" as const, riskCategories: ["behavior" as const], evidenceIds: ["source-hunk"] };
    const document = { summary: validSummary, chapters: [chapter], steps: [sourceStep], omittedGroups: [], unclassifiedEvidenceIds: [] };

    expect(parseAnalysisDocument(document, focusInput, { focus: "salvage" }).focus).toEqual({});
    expect(parseAnalysisDocument({
      ...document,
      focus: { "source-hunk": [{ start: 40, end: 50 }, { start: 9, end: 9 }], "not-real": [{ start: 1, end: 1 }] },
    }, focusInput, { focus: "salvage" }).focus).toEqual({ "source-hunk": [{ start: 9, end: 9 }] });
  });

  it("normalizes observed test execution and only asks for real runs", () => {
    const chapter = { id: "one", title: "Runner behavior", kind: "behavior" as const, synopsis: validSynopsis, confidence: "high" as const, attention: "contained" as const, riskCategories: ["behavior" as const], evidenceIds: ["source-hunk"] };
    const document = parseAnalysisDocument({
      summary: validSummary,
      chapters: [chapter],
      steps: [sourceStep],
      omittedGroups: [{ title: "Low-signal changes", reason: "Lockfile evidence is grouped.", evidenceIds: ["lock-hunk"] }],
      unclassifiedEvidenceIds: [],
      testExecution: [{ command: "npm test", outcome: "passed", summary: "All 84 tests passed across 15 files.", source: "conversation" }],
    }, input);
    expect(document.testExecution).toEqual([{ command: "npm test", outcome: "passed", summary: "All 84 tests passed across 15 files.", source: "conversation" }]);
    expect(analysisPrompt(input)).toContain("never invent execution evidence");
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
      x: [["npm test", "passed", "All tests passed.", "conversation"]],
    }, input)).toMatchObject({
      summary: validSummary,
      chapters: [{ id: "one", title: "Runner behavior", evidenceIds: ["source-hunk"] }],
      omittedGroups: [{ title: "Low-signal changes", evidenceIds: ["lock-hunk"] }],
      testExecution: [{ command: "npm test", outcome: "passed", summary: "All tests passed.", source: "conversation" }],
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

  it("inlines full hunk patch text for meaningful files so Codex skips git round trips", () => {
    const smallInput: CollectedReviewInput = {
      ...input,
      hunks: [
        {
          id: "source-hunk", fileId: "source", oldStart: 8, newStart: 8,
          lines: [
            { kind: "context", content: "export class Runner {", oldLine: 8, newLine: 8 },
            { kind: "deletion", content: "  run() { return null; }", oldLine: 9 },
            { kind: "addition", content: "  run(job) { return this.execute(job); }", newLine: 9 },
          ],
        },
        { id: "lock-hunk", fileId: "lock", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: '"version": "2.0.0",', newLine: 1 }] },
      ],
    };

    const manifest = buildPromptReviewInput(smallInput);

    expect(manifest.files[0].hunks[0].patch).toBe("@@ -8,2 +8,2 @@\n export class Runner {\n-  run() { return null; }\n+  run(job) { return this.execute(job); }");
    expect(manifest.files[1].hunks[0].patch).toBeUndefined();
    expect(analysisPrompt(smallInput)).toContain("Hunks that carry a patch field include their complete diff text inline");
  });

  it("stops inlining patch text at the budget so huge branches stay reference-first", () => {
    const largeInput: CollectedReviewInput = {
      ...input,
      files: [{ id: "source", path: "src/large.ts", status: "modified", binary: false, signal: "meaningful" }],
      hunks: Array.from({ length: 24 }, (_, hunkIndex) => ({
        id: `hunk-${hunkIndex}`,
        fileId: "source",
        oldStart: hunkIndex * 40 + 1,
        newStart: hunkIndex * 40 + 1,
        lines: Array.from({ length: 40 }, (_, lineIndex) => ({
          kind: "addition" as const,
          content: `const generatedValue${hunkIndex}_${lineIndex} = "${"full patch content ".repeat(8)}";`,
          newLine: hunkIndex * 40 + lineIndex + 1,
        })),
      })),
    };

    const hunks = buildPromptReviewInput(largeInput).files[0].hunks;
    const inlined = hunks.filter((hunk) => hunk.patch !== undefined);

    expect(inlined.length).toBeGreaterThan(0);
    expect(inlined.length).toBeLessThan(hunks.length);
    expect(inlined.reduce((total, hunk) => total + (hunk.patch?.length ?? 0), 0)).toBeLessThanOrEqual(INLINE_PATCH_BUDGET);
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

  it("uses worktree-inclusive inspection commands against the merge-base when dirty changes are part of the review", () => {
    const manifest = buildPromptReviewInput({ ...input, includesWorkingTree: true });

    expect(manifest.inspection.summaryCommand).toBe("git diff --stat --find-renames --find-copies base");
    expect(manifest.inspection.patchCommand).toBe("git diff --no-ext-diff --unified=80 --find-renames --find-copies base -- <path>");
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

    expect(analysisPrompt(input)).toContain("{s,c:[[id,title,kind,synopsis,before|null,after|null,confidence,attention,riskCategories,evidenceIds]],t:[[id,title,goal,youNowHave,[[concern,resolvedByStepId|null]],dependsOn,forwardRefs,advancesChapterIds,evidenceIds]],o:[[title,reason,evidenceIds]],u:[evidenceId],f:{evidenceId:[[startLine,endLine]]},x:[[command,outcome,summary,source]]}");
    expect(JSON.stringify(compactDocument).length).toBeLessThan(JSON.stringify(fullDocument).length * 0.7);
  });

  it("extracts the JSON document from narrated or fenced responses", () => {
    expect(extractJson('{"s":"ok"}')).toBe('{"s":"ok"}');
    expect(extractJson('I will inspect the repo first.\n\n```json\n{"s":"ok"}\n```\nDone.')).toBe('{"s":"ok"}');
    expect(extractJson('I inspected the branch and here is the document: {"s":"ok"} - let me know.')).toBe('{"s":"ok"}');
    expect(extractJson("no json here")).toBe("no json here");
    expect(extractJson('First run:\n```sh\nnpm test\n```\nThen the document:\n```json\n{"s":"ok"}\n```')).toBe('{"s":"ok"}');
    expect(extractJson('{"s":"ok"} Hope that helps! {"note":"not the document"}')).toBe('{"s":"ok"}');
    expect(extractJson('```json\n{"s":"a } brace and \\" quote inside"}\n```\ntrailing notes')).toBe('{"s":"a } brace and \\" quote inside"}');
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

describe("formatAnalysisHeartbeat", () => {
  it("reports elapsed time, the latest agent activity, draft growth, and staleness", () => {
    expect(formatAnalysisHeartbeat("Codex", 45_000, undefined)).toBe("still analyzing (45s): waiting for the first Codex event");
    expect(formatAnalysisHeartbeat("Codex", 125_000, { label: "running `git diff --stat`", notifications: 12, draftCharacters: 0 }, 2_000)).toBe("still analyzing (2m05s): running `git diff --stat`");
    expect(formatAnalysisHeartbeat("Claude Code", 200_000, { label: "drafting the narrative", notifications: 40, draftCharacters: 3_449 }, 1_000)).toBe("still analyzing (3m20s): drafting the narrative; 3.4k draft characters");
    expect(formatAnalysisHeartbeat("Claude Code", 300_000, { label: "reasoning about the branch", notifications: 12, draftCharacters: 120 }, 90_000)).toBe("still analyzing (5m00s): reasoning about the branch; 120 draft characters; no new Claude Code events for 1m30s");
  });
});
