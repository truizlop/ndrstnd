import type { ReviewPresentationData } from "./review-data.js";

/** A stable, intentionally representative review for presentation and visual tests. */
export const frozenReviewData: ReviewPresentationData = {
  sessionId: "frozen-session",
  revisionId: "frozen-revision",
  targetRef: "frozen-ui-change",
  baseRef: "main",
  mergeBase: "a1b2c3d4e5f6",
  files: [
    { id: "runner", path: "src/runner.ts", status: "modified", binary: false, signal: "meaningful" },
    { id: "runner-test", path: "test/runner.test.ts", status: "modified", binary: false, signal: "meaningful" },
  ],
  hunks: [
    {
      id: "runner-hunk", fileId: "runner", oldStart: 8, newStart: 8,
      lines: [
        { kind: "context", content: "export class Runner {", oldLine: 8, newLine: 8 },
        { kind: "addition", content: "  async run(job: Job) {", newLine: 9 },
        { kind: "addition", content: "    return this.execute(job);", newLine: 10 },
        { kind: "addition", content: "  }", newLine: 11 },
      ],
    },
    {
      id: "runner-test-hunk", fileId: "runner-test", oldStart: 12, newStart: 12,
      lines: [
        { kind: "addition", content: "it('runs a job', async () => {", newLine: 12 },
        { kind: "addition", content: "  await expect(runner.run(job)).resolves.toEqual(result);", newLine: 13 },
        { kind: "addition", content: "});", newLine: 14 },
      ],
    },
  ],
  document: {
    summary: "The runner now executes a supplied job and has direct test coverage.",
    chapters: [
      {
        id: "run-job", title: "Run the supplied job", kind: "behavior",
        synopsis: "The runner delegates the job to its execution path.",
        before: "Jobs could not be run through this entry point.",
        after: "Callers can run a job and receive its execution result.",
        confidence: "high", attention: "contained", riskCategories: ["behavior"], evidenceIds: ["runner-hunk"],
      },
      {
        id: "test-job", title: "Cover job execution", kind: "test",
        synopsis: "A focused test verifies the returned result.",
        confidence: "high", attention: "low", riskCategories: [], evidenceIds: ["runner-test-hunk"],
      },
    ],
    omittedGroups: [],
    unclassifiedEvidenceIds: [],
  },
};
