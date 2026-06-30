import { describe, expect, it } from "vitest";
import { analysisPrompt, buildFallbackAnalysis, buildPromptReviewInput, parseAnalysisDocument } from "../src/server/analyze.js";
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

describe("analysis documents", () => {
  it("creates an honest fallback that accounts for low-signal evidence", () => {
    expect(buildFallbackAnalysis(input)).toMatchObject({ chapters: [{ evidenceIds: ["source-hunk"] }], omittedGroups: [{ evidenceIds: ["lock-hunk"] }] });
  });

  it("rejects fabricated evidence", () => {
    expect(() => parseAnalysisDocument({ summary: "x", chapters: [{ id: "one", title: "x", kind: "other", synopsis: "x", confidence: "low", attention: "low", riskCategories: [], evidenceIds: ["not-real"] }], omittedGroups: [], unclassifiedEvidenceIds: [] }, input)).toThrow("unknown evidence");
  });

  it("rejects a document that leaves meaningful evidence unclassified", () => {
    expect(() => parseAnalysisDocument({ summary: "x", chapters: [], omittedGroups: [], unclassifiedEvidenceIds: [] }, input)).toThrow("did not account");
  });

  it("accepts compact Codex output and normalizes it to the presentation document", () => {
    expect(parseAnalysisDocument({
      s: "The app behavior is explained compactly.",
      c: [[
        "one",
        "Runner behavior",
        "behavior",
        "The runner now delegates work through the execution path.",
        "The entry point did not run jobs.",
        "Callers can run jobs and receive results.",
        "high",
        "contained",
        ["behavior"],
        ["source-hunk"],
      ]],
      o: [["Low-signal changes", "Lockfile evidence is grouped.", ["lock-hunk"]]],
      u: [],
    }, input)).toMatchObject({
      summary: "The app behavior is explained compactly.",
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

  it("asks for compact output that is materially smaller than the full document shape", () => {
    const compactDocument = {
      s: "Runner behavior and tests are now easier to understand.",
      c: Array.from({ length: 6 }, (_, index) => [`chapter-${index}`, "Runner behavior", "behavior", "The runner delegates jobs through execution.", "The entry point did not run jobs.", "Callers receive execution results.", "high", "contained", ["behavior"], [`hunk-${index}`]]),
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
      omittedGroups: compactDocument.o.map((group) => ({ title: group[0], reason: group[1], evidenceIds: group[2] })),
      unclassifiedEvidenceIds: compactDocument.u,
    };

    expect(analysisPrompt(input)).toContain("{s,c:[[id,title,kind,synopsis,before|null,after|null,confidence,attention,riskCategories,evidenceIds]],o:[[title,reason,evidenceIds]],u:[evidenceId]}");
    expect(JSON.stringify(compactDocument).length).toBeLessThan(JSON.stringify(fullDocument).length * 0.7);
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
