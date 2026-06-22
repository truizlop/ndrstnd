import { describe, expect, it } from "vitest";
import { buildFallbackAnalysis, parseAnalysisDocument } from "../src/server/analyze.js";
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
});
