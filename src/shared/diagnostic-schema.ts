import { z } from "zod";

export const DIAGNOSTIC_ARTIFACT_VERSION = 1;

const TextMetadataSchema = z.object({
  length: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DiagnosticTextMetadata = z.infer<typeof TextMetadataSchema>;

const ResponseMetadataSchema = TextMetadataSchema.extend({
  extractedLength: z.number().int().min(0),
  extractedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  fenced: z.boolean(),
  candidateStartsWithObject: z.boolean(),
});
export type DiagnosticResponseMetadata = z.infer<typeof ResponseMetadataSchema>;

const ActivitySchema = z.object({
  label: z.string().min(1).max(300),
  notifications: z.number().int().min(0),
  draftCharacters: z.number().int().min(0),
});
export type DiagnosticActivity = z.infer<typeof ActivitySchema>;

const ValidationSchema = z.object({
  phase: z.enum(["json-parsing", "wire-validation", "review-validation"]),
  message: z.string().min(1).max(8_000),
});
export type DiagnosticValidation = z.infer<typeof ValidationSchema>;

const DiagnosticAttemptSchema = z.object({
  kind: z.enum(["initial", "repair"]),
  durationMs: z.number().int().min(0),
  prompt: TextMetadataSchema,
  response: ResponseMetadataSchema.optional(),
  activity: ActivitySchema.optional(),
  validation: ValidationSchema.optional(),
  error: z.string().min(1).max(8_000).optional(),
});

const ReviewFileDiagnosticSchema = z.object({
  path: z.string().min(1).max(1_000),
  status: z.string().min(1).max(40),
  binary: z.boolean(),
  signal: z.enum(["meaningful", "low-signal"]),
  signalReason: z.string().max(300).optional(),
  hunkCount: z.number().int().min(0),
});

const ReviewScopeDiagnosticSchema = z.object({
  repoPath: z.string().min(1),
  targetRef: z.string().min(1),
  baseRef: z.string().min(1),
  mergeBase: z.string().min(1),
  includesWorkingTree: z.boolean(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  fileCount: z.number().int().min(0),
  meaningfulFileCount: z.number().int().min(0),
  hunkCount: z.number().int().min(0),
  files: z.array(ReviewFileDiagnosticSchema),
});

export const DiagnosticArtifactSchema = z.object({
  kind: z.literal("ndrstnd-analysis-diagnostic"),
  version: z.literal(DIAGNOSTIC_ARTIFACT_VERSION),
  createdAt: z.string().datetime(),
  tool: z.object({
    version: z.string().min(1),
    node: z.string().min(1),
    platform: z.string().min(1),
    arch: z.string().min(1),
  }),
  command: z.object({
    name: z.literal("review"),
    args: z.array(z.string().max(2_000)),
  }),
  agent: z.object({
    id: z.enum(["codex", "claude"]),
    name: z.string().min(1),
    command: z.string().min(1),
  }).optional(),
  scope: ReviewScopeDiagnosticSchema.optional(),
  failure: z.object({
    phase: z.enum(["setup", "authentication", "collection", "analysis", "artifact-writing", "unknown"]),
    message: z.string().min(1).max(8_000),
  }),
  attempts: z.array(DiagnosticAttemptSchema),
  sensitiveDataIncluded: z.boolean(),
  rawAgentResponses: z.array(z.object({
    turn: z.number().int().min(1),
    response: z.string(),
  })).optional(),
  nextSteps: z.array(z.string().min(1).max(1_000)).min(1),
});

export type DiagnosticArtifact = z.infer<typeof DiagnosticArtifactSchema>;
export type DiagnosticAttempt = z.infer<typeof DiagnosticAttemptSchema>;
export type DiagnosticPhase = z.infer<typeof DiagnosticArtifactSchema>["failure"]["phase"];
export type DiagnosticFailure = DiagnosticArtifact["failure"];
