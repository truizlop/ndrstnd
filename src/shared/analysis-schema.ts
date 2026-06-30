import { z } from "zod";

export const RiskCategorySchema = z.enum(["formatting", "refactor", "behavior", "performance", "security"]);
export const AttentionSchema = z.enum(["low", "contained", "elevated", "high", "critical"]);

export const ChapterSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  kind: z.enum(["feature", "decision", "behavior", "non_functional", "risk", "test", "other"]),
  synopsis: z.string().min(1).max(260),
  before: z.string().max(260).optional(),
  after: z.string().max(260).optional(),
  confidence: z.enum(["high", "medium", "low"]),
  attention: AttentionSchema,
  riskCategories: z.array(RiskCategorySchema),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const AnalysisDocumentSchema = z.object({
  summary: z.string().min(1).max(320),
  chapters: z.array(ChapterSchema),
  omittedGroups: z.array(z.object({ title: z.string().min(1).max(120), reason: z.string().min(1).max(220), evidenceIds: z.array(z.string().min(1)).min(1) })),
  unclassifiedEvidenceIds: z.array(z.string().min(1)),
});

export type AnalysisDocument = z.infer<typeof AnalysisDocumentSchema>;
