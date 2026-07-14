import { z } from "zod";

export const RiskCategorySchema = z.enum(["formatting", "refactor", "behavior", "performance", "security"]);
export const AttentionSchema = z.enum(["low", "contained", "elevated", "high", "critical"]);

export const ChapterSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  kind: z.enum(["feature", "decision", "behavior", "non_functional", "risk", "test", "other"]),
  synopsis: z.string().min(1).max(1_200),
  before: z.string().max(900).optional(),
  after: z.string().max(900).optional(),
  confidence: z.enum(["high", "medium", "low"]),
  attention: AttentionSchema,
  riskCategories: z.array(RiskCategorySchema),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const AnalysisStepSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(900),
  youNowHave: z.string().min(1).max(900),
  deferred: z.array(z.object({
    concern: z.string().min(1).max(700),
    resolvedByStepId: z.string().min(1).max(80).optional(),
  })),
  dependsOn: z.array(z.string().min(1).max(80)),
  forwardRefs: z.record(z.string().min(1), z.string().min(1).max(80)),
  advancesChapterIds: z.array(z.string().min(1).max(80)).min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const FocusRangeSchema = z.object({ start: z.number().int().min(1), end: z.number().int().min(1) });

export const TestExecutionSchema = z.object({
  command: z.string().min(1).max(200),
  outcome: z.enum(["passed", "failed", "mixed", "unknown"]),
  summary: z.string().min(1).max(300),
  source: z.enum(["conversation", "repository"]),
});

export const AnalysisDocumentSchema = z.object({
  summary: z.string().min(1).max(1_600),
  chapters: z.array(ChapterSchema),
  steps: z.array(AnalysisStepSchema),
  omittedGroups: z.array(z.object({ title: z.string().min(1).max(240), reason: z.string().min(1).max(700), evidenceIds: z.array(z.string().min(1)).min(1) })),
  unclassifiedEvidenceIds: z.array(z.string().min(1)),
  /** Reviewer-critical new-file line ranges per evidence ID; they drive the focused excerpts at the Evidence zoom. */
  focus: z.record(z.string().min(1), z.array(FocusRangeSchema).min(1).max(5)).optional(),
  /** Test or build runs actually observed in the conversation or repository; never inferred. */
  testExecution: z.array(TestExecutionSchema).max(5).optional(),
});

export type AnalysisDocument = z.infer<typeof AnalysisDocumentSchema>;

/** Bump on any incompatible change to AnalysisDocument so cached revisions from older versions are re-analyzed instead of rendered broken. */
export const ANALYSIS_DOCUMENT_VERSION = 1;
