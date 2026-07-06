import type { AnalysisDocument } from "../../src/shared/analysis-schema.js";
import type { CollectedReviewInput } from "../../src/server/git.js";

export function buildTestAnalysis(input: CollectedReviewInput): AnalysisDocument {
  const filesById = new Map(input.files.map((file) => [file.id, file]));
  const meaningful = input.hunks.filter((hunk) => filesById.get(hunk.fileId)?.signal === "meaningful");
  const lowSignal = input.hunks.filter((hunk) => filesById.get(hunk.fileId)?.signal === "low-signal");
  const chapters = meaningful.length === 0 ? [] : [{
    id: "changed-behavior",
    title: "Changed behavior",
    kind: "behavior" as const,
    synopsis: "The branch changes the behavior represented by this evidence.",
    confidence: "high" as const,
    attention: "contained" as const,
    riskCategories: ["behavior" as const],
    evidenceIds: meaningful.map((hunk) => hunk.id),
  }];
  const steps = meaningful.length === 0 ? [] : [{
    id: "step-01",
    title: "Introduce the changed behavior",
    goal: "Land the behavior change as one increment.",
    youNowHave: "The changed behavior exists with its evidence.",
    deferred: [],
    dependsOn: [],
    forwardRefs: {},
    advancesChapterIds: ["changed-behavior"],
    evidenceIds: meaningful.map((hunk) => hunk.id),
  }];
  return {
    summary: `${input.files.length} changed file${input.files.length === 1 ? "" : "s"} are explained by this test analysis.`,
    chapters,
    steps,
    omittedGroups: lowSignal.length === 0 ? [] : [{ title: "Low-signal changes", reason: "Automatically classified as generated, binary, vendor, or lockfile content.", evidenceIds: lowSignal.map((hunk) => hunk.id) }],
    unclassifiedEvidenceIds: [],
  };
}
