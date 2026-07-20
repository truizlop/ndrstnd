import type { AnalysisDocument } from "../shared/analysis-schema.js";
import { AnalysisDocumentSchema, TestExecutionSchema } from "../shared/analysis-schema.js";
import { z } from "zod";
import type { CollectedReviewInput } from "./git.js";
import type { ConversationContext } from "./conversation.js";
import { deriveEvidenceOrder } from "./evidence-ordering.js";

export function parseAnalysisDocument(value: unknown, input: CollectedReviewInput, options?: { focus?: "require" | "salvage" }): AnalysisDocument {
  const document = parseWireAnalysisDocument(value, input);
  const duplicateChapterIds = duplicated(document.chapters.map((chapter) => chapter.id));
  if (duplicateChapterIds.length > 0) throw new Error(`Analysis chapter ids are duplicated: ${duplicateChapterIds.join(", ")}. Give every chapter in c a unique id.`);
  const duplicateStepIds = duplicated(document.steps.map((step) => step.id));
  if (duplicateStepIds.length > 0) throw new Error(`Analysis step ids are duplicated: ${duplicateStepIds.join(", ")}. Give every step in t a unique id.`);
  const classified = [
    ...document.chapters.flatMap((chapter) => chapter.evidenceIds),
    ...document.omittedGroups.flatMap((group) => group.evidenceIds),
    ...document.unclassifiedEvidenceIds,
  ];
  const duplicateEvidence = duplicated(classified);
  if (duplicateEvidence.length > 0) throw new Error(`Analysis evidence was classified more than once: ${duplicateEvidence.join(", ")}. Each evidence ID must appear exactly once across c, o, and u.`);
  const knownEvidence = new Set(input.hunks.map((hunk) => hunk.id));
  const referenced = new Set(classified);
  for (const id of referenced) if (!knownEvidence.has(id)) throw new Error(`Analysis referenced unknown evidence: ${id}. Use only hunk IDs listed in the review input manifest.`);
  const meaningfulEvidence = input.hunks
    .filter((hunk) => input.files.find((file) => file.id === hunk.fileId)?.signal === "meaningful")
    .map((hunk) => hunk.id);
  const missing = meaningfulEvidence.filter((id) => !referenced.has(id));
  if (missing.length > 0) throw new Error(`Analysis did not account for meaningful evidence: ${missing.join(", ")}. Add each missing ID to a chapter (c), an omitted group (o), or unclassified (u).`);
  const grouped = new Set<string>();
  for (const chapter of document.chapters) for (const id of chapter.evidenceIds) grouped.add(id);
  for (const group of document.omittedGroups) for (const id of group.evidenceIds) grouped.add(id);
  const strayLowSignal = input.hunks
    .filter((hunk) => input.files.find((file) => file.id === hunk.fileId)?.signal === "low-signal")
    .map((hunk) => hunk.id)
    .filter((id) => !grouped.has(id));
  if (strayLowSignal.length > 0) throw new Error(`Low-signal evidence was left ungrouped: ${strayLowSignal.join(", ")}. Add each ID to an omitted group in o with a short reason (for example lockfile churn or generated output); u is only for meaningful evidence that defies classification.`);
  validateStepPlan(document, input, meaningfulEvidence);
  validateFocus(document, input, options?.focus ?? "require");
  validateProseDepth(document);
  return document;
}

/**
 * "require" rejects missing or invalid focus so the repair loop demands it;
 * "salvage" (the final attempt) keeps whatever focus is valid and lets the
 * renderer fall back to heuristics, so a review never fails over focus alone.
 */
function validateFocus(document: AnalysisDocument, input: CollectedReviewInput, mode: "require" | "salvage"): void {
  const hunksById = new Map(input.hunks.map((hunk) => [hunk.id, hunk]));
  const focus = document.focus ?? {};
  const valid: NonNullable<AnalysisDocument["focus"]> = {};
  for (const [evidenceId, ranges] of Object.entries(focus)) {
    const hunk = hunksById.get(evidenceId);
    if (hunk === undefined) {
      if (mode === "require") throw new Error(`Focus referenced unknown evidence: ${evidenceId}. Use only hunk IDs listed in the review input manifest.`);
      continue;
    }
    const newLines = hunk.lines.flatMap((line) => (line.newLine === undefined ? [] : [line.newLine]));
    const span = newLines.length === 0 ? "none" : `${Math.min(...newLines)}-${Math.max(...newLines)}`;
    const validRanges = ranges.filter((range) => {
      if (range.start > range.end) {
        if (mode === "require") throw new Error(`Focus range for ${evidenceId} is inverted: [${range.start},${range.end}]. Give [startLine,endLine] with startLine <= endLine.`);
        return false;
      }
      if (!newLines.some((line) => line >= range.start && line <= range.end)) {
        if (mode === "require") throw new Error(`Focus range [${range.start},${range.end}] for ${evidenceId} selects no lines of that hunk; its new-file lines span ${span}. Use new-file line numbers from the patch.`);
        return false;
      }
      return true;
    });
    if (validRanges.length > 0) valid[evidenceId] = validRanges;
  }
  if (mode === "salvage") {
    document.focus = valid;
    return;
  }
  const missingFocus = document.chapters
    .flatMap((chapter) => chapter.evidenceIds)
    .filter((id) => focus[id] === undefined)
    .filter((id) => (hunksById.get(id)?.lines ?? []).some((line) => line.newLine !== undefined));
  if (missingFocus.length > 0) throw new Error(`Focus is missing for chapter evidence: ${[...new Set(missingFocus)].join(", ")}. Add each ID to f with 1-3 [startLine,endLine] new-file line ranges covering the lines a reviewer must read first.`);
}

export const PROSE_WORD_RANGES = {
  summary: { min: 35, max: 75 },
  synopsis: { min: 20, max: 55 },
  beforeAfter: { min: 8, max: 40 },
  goal: { min: 12, max: 40 },
  youNowHave: { min: 12, max: 40 },
} as const;

const ManifestIndexSchema = z.number().int().min(0);
const AgentDeferredSchema = z.object({
  concern: z.string().min(1).max(700),
  resolvedByStepId: z.string().min(1).max(80).nullable().optional(),
});
const AgentForwardRefSchema = z.object({
  symbol: z.string().min(1),
  introducedByStepId: z.string().min(1).max(80),
});
const AgentChapterSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  kind: z.enum(["feature", "decision", "behavior", "non_functional", "risk", "test", "other"]),
  synopsis: z.string().min(1).max(1_200),
  before: z.string().max(900).nullable().optional(),
  after: z.string().max(900).nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]),
  attention: z.enum(["low", "contained", "elevated", "high", "critical"]),
  riskCategories: z.array(z.enum(["formatting", "refactor", "behavior", "performance", "security"])),
  evidenceIndexes: z.array(ManifestIndexSchema).min(1),
});
const AgentStepSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(900),
  youNowHave: z.string().min(1).max(900),
  deferred: z.array(AgentDeferredSchema),
  dependsOn: z.array(z.string().min(1).max(80)),
  forwardRefs: z.array(AgentForwardRefSchema),
  advancesChapterIds: z.array(z.string().min(1).max(80)).min(1),
  evidenceIndexes: z.array(ManifestIndexSchema).min(1),
});
const AgentOmittedGroupSchema = z.object({
  title: z.string().min(1).max(240),
  reason: z.string().min(1).max(700),
  evidenceIndexes: z.array(ManifestIndexSchema).min(1),
});
const AgentFocusSchema = z.object({
  evidenceIndex: ManifestIndexSchema,
  ranges: z.array(z.object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
  })).min(1).max(5),
});
const AgentAnalysisDocumentSchema = z.object({
  summary: z.string().min(1).max(1_600),
  chapters: z.array(AgentChapterSchema),
  steps: z.array(AgentStepSchema),
  omittedGroups: z.array(AgentOmittedGroupSchema),
  unclassifiedEvidenceIndexes: z.array(ManifestIndexSchema),
  focus: z.array(AgentFocusSchema).optional(),
  testExecution: z.array(TestExecutionSchema).max(5).optional(),
});

function duplicated(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function proseIssue(label: string, text: string, range: { min: number; max: number }): string | undefined {
  const words = wordCount(text);
  if (words < range.min) return `${label} is ${words} words but must be ${range.min}-${range.max}: expand it with the concrete mechanisms, symbols, and consequences involved, not filler.`;
  if (words > range.max) return `${label} is ${words} words but must be ${range.min}-${range.max}: cut it down to the load-bearing facts.`;
  return undefined;
}

function validateProseDepth(document: AnalysisDocument): void {
  const issues: Array<string | undefined> = [proseIssue("The summary", document.summary, PROSE_WORD_RANGES.summary)];
  for (const chapter of document.chapters) {
    issues.push(proseIssue(`Chapter ${chapter.id} synopsis`, chapter.synopsis, PROSE_WORD_RANGES.synopsis));
    if (chapter.before !== undefined) issues.push(proseIssue(`Chapter ${chapter.id} before`, chapter.before, PROSE_WORD_RANGES.beforeAfter));
    if (chapter.after !== undefined) issues.push(proseIssue(`Chapter ${chapter.id} after`, chapter.after, PROSE_WORD_RANGES.beforeAfter));
  }
  for (const step of document.steps) {
    issues.push(proseIssue(`Step ${step.id} goal`, step.goal, PROSE_WORD_RANGES.goal));
    issues.push(proseIssue(`Step ${step.id} youNowHave`, step.youNowHave, PROSE_WORD_RANGES.youNowHave));
  }
  const found = issues.filter((issue): issue is string => issue !== undefined);
  if (found.length > 0) throw new Error(`Analysis prose depth is out of range; fix every field listed and keep all other fields unchanged. ${found.join(" ")}`);
}

function validateStepPlan(document: AnalysisDocument, input: CollectedReviewInput, meaningfulEvidence: string[]) {
  const knownChapters = new Set(document.chapters.map((chapter) => chapter.id));
  const knownSteps = new Set(document.steps.map((step) => step.id));
  for (const step of document.steps) {
    for (const chapterId of step.advancesChapterIds) {
      if (!knownChapters.has(chapterId)) throw new Error(`Analysis step ${step.id} advances unknown chapter: ${chapterId}. Every advancesChapterIds entry must match a chapter id declared in c.`);
    }
    for (const dependency of step.dependsOn) {
      if (!knownSteps.has(dependency)) throw new Error(`Analysis step ${step.id} depends on unknown step: ${dependency}. dependsOn may only reference ids of other steps in t.`);
    }
    for (const targetStep of Object.values(step.forwardRefs)) {
      if (!knownSteps.has(targetStep)) throw new Error(`Analysis step ${step.id} forward references unknown step: ${targetStep}. Each forwardRefs value must be the id of the step that introduces the symbol.`);
    }
  }

  const stepEvidence = new Map<string, string>();
  for (const step of document.steps) {
    for (const evidenceId of step.evidenceIds) {
      if (stepEvidence.has(evidenceId)) throw new Error(`Analysis step evidence was duplicated: ${evidenceId}. Each evidence ID must appear in exactly one step; keep it in the step where the change is introduced.`);
      stepEvidence.set(evidenceId, step.id);
    }
  }
  const missing = meaningfulEvidence.filter((id) => !stepEvidence.has(id));
  if (missing.length > 0) throw new Error(`Analysis steps did not account for meaningful evidence: ${missing.join(", ")}. Assign each missing ID to exactly one step in t.`);
  const extra = [...stepEvidence.keys()].filter((id) => !meaningfulEvidence.includes(id));
  if (extra.length > 0) throw new Error(`Analysis steps referenced non-meaningful evidence: ${extra.join(", ")}. Steps may only contain meaningful evidence IDs; low-signal evidence belongs in omitted groups.`);

  const stepIndex = new Map(document.steps.map((step, index) => [step.id, index]));
  const stepByEvidence = new Map([...stepEvidence.entries()].map(([evidenceId, stepId]) => [evidenceId, document.steps.find((step) => step.id === stepId)!]));
  // Only define-before-use is a hard invariant; layer and test constraints stay
  // suggestions because a good step plan may interleave tests with their subject.
  for (const constraint of deriveEvidenceOrder(input.hunks, input.files).constraints) {
    if (constraint.reason !== "symbol" || constraint.symbol === undefined) continue;
    const before = stepByEvidence.get(constraint.beforeEvidenceId);
    const after = stepByEvidence.get(constraint.afterEvidenceId);
    if (before === undefined || after === undefined || before.id === after.id) continue;
    if ((stepIndex.get(before.id) ?? 0) < (stepIndex.get(after.id) ?? 0)) continue;
    if (after.forwardRefs[constraint.symbol] !== before.id) {
      throw new Error(`Analysis step order violates symbol ${constraint.symbol}: ${before.id} must come before ${after.id}. Reorder the steps, or declare forwardRefs [{"symbol":"${constraint.symbol}","introducedByStepId":"${before.id}"}] on ${after.id} if the forward use is intentional.`);
    }
  }
}

const AGENT_ANALYSIS_FORMAT = `Return exactly one JSON object using explicit property names. This is intentionally more verbose than the legacy compact format: never use the short keys s, c, t, o, u, f, or x; never use positional arrays or hunk ID strings.

The top-level properties are summary, chapters, steps, omittedGroups, unclassifiedEvidenceIndexes, and optionally focus and testExecution. Chapters are objects with id, title, kind, synopsis, before, after, confidence, attention, riskCategories, and evidenceIndexes. Use null for before or after when there is no concrete before or after description. Steps are objects with id, title, goal, youNowHave, deferred, dependsOn, forwardRefs, advancesChapterIds, and evidenceIndexes. Each deferred item is an object with concern and optional resolvedByStepId; use null when no later step resolves it. Each forward reference is an object with symbol and introducedByStepId. Focus is an array of objects with evidenceIndex and ranges; each range is an object with startLine and endLine. Test executions are objects with command, outcome, summary, and source.

All evidenceIndexes and unclassifiedEvidenceIndexes values are zero-based integer indexes into the numbered review manifest. Each meaningful evidence index must appear exactly once in a chapter, omitted group, or unclassifiedEvidenceIndexes, and exactly once in steps. Group every low-signal evidence index into an omitted group with a short reason; unclassifiedEvidenceIndexes is a last resort. Focus drives the Evidence zoom excerpts: include it only for chapter evidence and give each focused evidence index 1-3 new-file line ranges. Omit testExecution when no run was actually observed; never invent execution evidence. Use empty arrays for no deferred concerns, dependencies, forward references, omitted groups, or unclassified evidence. This is the canonical shape, and every object field must be present except before, after, resolvedByStepId, focus, and testExecution.

Canonical shape:
{"summary":"...","chapters":[{"id":"chapter-01","title":"...","kind":"behavior","synopsis":"...","before":null,"after":null,"confidence":"medium","attention":"contained","riskCategories":["behavior"],"evidenceIndexes":[0]}],"steps":[{"id":"step-01","title":"...","goal":"...","youNowHave":"...","deferred":[{"concern":"...","resolvedByStepId":null}],"dependsOn":[],"forwardRefs":[],"advancesChapterIds":["chapter-01"],"evidenceIndexes":[0]}],"omittedGroups":[],"unclassifiedEvidenceIndexes":[],"focus":[{"evidenceIndex":0,"ranges":[{"startLine":10,"endLine":12}]}],"testExecution":[{"command":"npm test","outcome":"passed","summary":"...","source":"repository"}]}`;

export function analysisPrompt(input: CollectedReviewInput, conversation?: ConversationContext): string {
  const reviewInput = buildPromptReviewInput(input, conversation);
  return `You are ndrstnd, a comprehension assistant. Explain a branch without critiquing it or proposing changes. Prioritize the implementation story and behavior changes.

${AGENT_ANALYSIS_FORMAT}

Prose depth is validated and out-of-range fields are rejected, so hit these word counts: summary ${PROSE_WORD_RANGES.summary.min}-${PROSE_WORD_RANGES.summary.max} words; each synopsis ${PROSE_WORD_RANGES.synopsis.min}-${PROSE_WORD_RANGES.synopsis.max} words across two or three sentences explaining what changed, how it works, and why it matters; before and after ${PROSE_WORD_RANGES.beforeAfter.min}-${PROSE_WORD_RANGES.beforeAfter.max} words each describing concrete observable behavior; each step goal ${PROSE_WORD_RANGES.goal.min}-${PROSE_WORD_RANGES.goal.max} words stating the intent and mechanism; each youNowHave ${PROSE_WORD_RANGES.youNowHave.min}-${PROSE_WORD_RANGES.youNowHave.max} words stating the capability that now exists. Titles stay under 10 words. Name the actual functions, types, and files involved. Never answer with a single vague sentence, and never pad - every sentence must add information a reviewer can act on.

Timeline steps are a rational reconstruction of how to build this branch. They are not commit chronology, file order, or the Story chapters repeated. Each step must be one capability increment; explain its intent in goal, its postcondition in youNowHave, intentionally postponed concerns in deferred, earlier step ids in dependsOn, unavoidable forward symbol uses in forwardRefs as objects with symbol and introducedByStepId, the Story chapters it advances, and its evidence indexes. The manifest's construction.defineBeforeUse entries are hard ordering rules: each symbol must be defined in the same or an earlier step than its use, or the using step must declare it in forwardRefs. construction.suggestedEvidenceOrder is one valid linearization of manifest indexes you may regroup into steps.

When the review input includes conversation, it is the dialogue between the user and the coding agent that produced this branch. Treat it as primary evidence of intent: explain why changes were made, which alternatives were considered or rejected, and which incidents, requirements, or downstream consumers motivated them, weaving those stated reasons into the summary, chapter synopses, before/after, step goals, and deferred concerns instead of guessing intent from the code alone. Attribute reasons faithfully - never invent motives the conversation does not support, and never copy credentials or secrets from it. When conversation is absent, ground every claim in the diff and repository alone.

You are running in the reviewed repository with a read-only sandbox. The review input below is a compact manifest. Hunks that carry a patch field include their complete diff text inline - never re-fetch those with git. For hunks without inline patch text, or when you need surrounding code, use the file paths, manifest indexes, line anchors, and suggested git commands to inspect only what you still need for a high-quality comprehension story. Prefer grouping related evidence indexes by behavior or decision instead of mirroring path order.

Review input:
${JSON.stringify(reviewInput)}`;
}

/**
 * Inline patch text spares the analysis agent a git round trip per hunk, the dominant cost
 * on small and medium branches, where every inspection command is a full model
 * turn. The budget keeps huge branches on reference-first inspection so the
 * prompt stays bounded.
 */
export const INLINE_PATCH_BUDGET = 40_000;

export function buildPromptReviewInput(input: CollectedReviewInput, conversation?: ConversationContext) {
  const filesById = new Map(input.files.map((file) => [file.id, file]));
  const hunksByFile = new Map<string, Array<ReturnType<typeof compactHunk>>>();
  let inlinePatchBudget = INLINE_PATCH_BUDGET;
  for (const [index, hunk] of input.hunks.entries()) {
    const file = filesById.get(hunk.fileId);
    let patch: string | undefined;
    if (file?.signal === "meaningful" && !file.binary && hunk.lines.length > 0) {
      const text = hunkPatchText(hunk);
      if (text.length <= inlinePatchBudget) {
        inlinePatchBudget -= text.length;
        patch = text;
      }
    }
    const compact = compactHunk(hunk, file?.path, patch, index);
    const list = hunksByFile.get(hunk.fileId) ?? [];
    list.push(compact);
    hunksByFile.set(hunk.fileId, list);
  }
  const evidenceOrder = deriveEvidenceOrder(input.hunks, input.files);

  return {
    target: input.targetRef,
    base: input.baseRef,
    mergeBase: input.mergeBase,
    inspection: {
      workingDirectory: input.repoPath,
      summaryCommand: `git diff --stat --find-renames --find-copies ${diffRange(input)}`,
      patchCommand: `git diff --no-ext-diff --unified=80 --find-renames --find-copies ${diffRange(input)} -- <path>`,
      currentFileCommand: "sed -n '<start>,<end>p' <path>",
      note: "Hunks with a patch field carry their complete diff inline; run the patch command only for hunks without one or when surrounding code matters. For untracked working-tree files, inspect the current file directly. Refer to hunks by their numbered manifest index, never by inventing an identifier.",
    },
    files: input.files.map((file) => ({
      id: file.id,
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      binary: file.binary,
      signal: file.signal,
      signalReason: file.signalReason,
      hunks: hunksByFile.get(file.id) ?? [],
    })),
    construction: {
      suggestedEvidenceOrder: evidenceOrder.orderedEvidenceIds.map((id) => input.hunks.findIndex((hunk) => hunk.id === id)),
      defineBeforeUse: evidenceOrder.constraints
        .filter((constraint) => constraint.reason === "symbol")
        .map((constraint) => ({ symbol: constraint.symbol, definedIn: input.hunks.findIndex((hunk) => hunk.id === constraint.beforeEvidenceId), usedIn: input.hunks.findIndex((hunk) => hunk.id === constraint.afterEvidenceId) })),
    },
    conversation: compactConversation(conversation),
  };
}

const KindSchema = z.enum(["feature", "decision", "behavior", "non_functional", "risk", "test", "other"]);
const ConfidenceSchema = z.enum(["high", "medium", "low"]);
const CompactRiskCategorySchema = z.enum(["formatting", "refactor", "behavior", "performance", "security"]);
const CompactChapterSchema = z.tuple([
  z.string().min(1).max(80),
  z.string().min(1).max(120),
  KindSchema,
  z.string().min(1).max(1_200),
  z.string().max(900).nullable(),
  z.string().max(900).nullable(),
  ConfidenceSchema,
  z.enum(["low", "contained", "elevated", "high", "critical"]),
  z.array(CompactRiskCategorySchema),
  z.array(z.union([z.number().int().min(0), z.string().min(1)])).min(1),
]);
const CompactStepSchema = z.tuple([
  z.string().min(1).max(80),
  z.string().min(1).max(120),
  z.string().min(1).max(900),
  z.string().min(1).max(900),
  z.array(z.tuple([z.string().min(1).max(700), z.string().min(1).max(80).nullable()])),
  z.array(z.string().min(1).max(80)),
  z.record(z.string().min(1), z.string().min(1).max(80)),
  z.array(z.string().min(1).max(80)).min(1),
  z.array(z.union([z.number().int().min(0), z.string().min(1)])).min(1),
]);

const CompactEvidenceRefSchema = z.union([z.number().int().min(0), z.string().min(1)]);
const CompactChapterObjectSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  kind: KindSchema,
  synopsis: z.string().min(1).max(1_200),
  before: z.string().max(900).nullable().optional(),
  after: z.string().max(900).nullable().optional(),
  confidence: ConfidenceSchema,
  attention: z.enum(["low", "contained", "elevated", "high", "critical"]),
  riskCategories: z.array(CompactRiskCategorySchema),
  evidenceIndexes: z.array(z.number().int().min(0)).min(1),
});
const CompactStepObjectSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(900),
  youNowHave: z.string().min(1).max(900),
  deferred: z.array(AgentDeferredSchema),
  dependsOn: z.array(z.string().min(1).max(80)),
  forwardRefs: z.record(z.string().min(1), z.string().min(1).max(80)),
  advancesChapterIds: z.array(z.string().min(1).max(80)).min(1),
  evidenceIndexes: z.array(z.number().int().min(0)).min(1),
});
const CompactOmittedGroupSchema = z.tuple([z.string().min(1).max(240), z.string().min(1).max(700), z.array(CompactEvidenceRefSchema).min(1)]);
const CompactOmittedGroupObjectSchema = z.object({ title: z.string().min(1).max(240), reason: z.string().min(1).max(700), evidenceIndexes: z.array(z.number().int().min(0)).min(1) });

const CompactAnalysisDocumentSchema = z.object({
  s: z.string().min(1).max(1_600),
  c: z.array(z.union([CompactChapterSchema, CompactChapterObjectSchema])),
  t: z.array(z.union([CompactStepSchema, CompactStepObjectSchema])),
  o: z.array(z.union([CompactOmittedGroupSchema, CompactOmittedGroupObjectSchema])),
  u: z.array(CompactEvidenceRefSchema),
  f: z.record(z.string().min(1), z.array(z.tuple([z.number().int().min(1), z.number().int().min(1)])).min(1).max(5)).optional(),
  x: z.array(z.tuple([z.string().min(1).max(200), z.enum(["passed", "failed", "mixed", "unknown"]), z.string().min(1).max(300), z.enum(["conversation", "repository"])])).max(5).optional(),
});

function parseWireAnalysisDocument(value: unknown, input: CollectedReviewInput): AnalysisDocument {
  const full = AnalysisDocumentSchema.safeParse(value);
  if (full.success) return full.data;

  const agent = AgentAnalysisDocumentSchema.safeParse(value);
  if (agent.success) return normalizeAgentAnalysisDocument(agent.data, input);

  const compactResult = CompactAnalysisDocumentSchema.safeParse(value);
  if (!compactResult.success) {
    // Repair turns quote this message; reporting the schema the document was aiming for keeps those turns productive.
    const shape = isAgentShaped(value) ? "agent" : isFullShaped(value) ? "full" : "compact";
    const error = shape === "agent" ? agent.error : shape === "full" ? full.error : compactResult.error;
    throw new Error(`Analysis document did not match the ${shape} shape: ${formatSchemaIssues(error)}`);
  }
  const compact = compactResult.data;
  const evidenceId = (reference: number | string): string => typeof reference === "string" && !/^\d+$/.test(reference) ? reference : evidenceIdAtIndex(input, Number(reference));
  return AnalysisDocumentSchema.parse({
    summary: compact.s,
    chapters: compact.c.map((chapter) => Array.isArray(chapter) ? {
      id: chapter[0], title: chapter[1], kind: chapter[2], synopsis: chapter[3],
      before: chapter[4] ?? undefined, after: chapter[5] ?? undefined,
      confidence: chapter[6], attention: chapter[7], riskCategories: chapter[8],
      evidenceIds: chapter[9].map(evidenceId),
    } : {
      id: chapter.id, title: chapter.title, kind: chapter.kind, synopsis: chapter.synopsis,
      before: chapter.before ?? undefined, after: chapter.after ?? undefined,
      confidence: chapter.confidence, attention: chapter.attention, riskCategories: chapter.riskCategories,
      evidenceIds: chapter.evidenceIndexes.map(evidenceId),
    }),
    steps: compact.t.map((step) => Array.isArray(step) ? {
      id: step[0], title: step[1], goal: step[2], youNowHave: step[3],
      deferred: step[4].map((item) => ({ concern: item[0], resolvedByStepId: item[1] ?? undefined })),
      dependsOn: step[5], forwardRefs: step[6], advancesChapterIds: step[7],
      evidenceIds: step[8].map(evidenceId),
    } : {
      id: step.id, title: step.title, goal: step.goal, youNowHave: step.youNowHave,
      deferred: step.deferred.map((item) => ({ concern: item.concern, resolvedByStepId: item.resolvedByStepId ?? undefined })),
      dependsOn: step.dependsOn, forwardRefs: step.forwardRefs, advancesChapterIds: step.advancesChapterIds,
      evidenceIds: step.evidenceIndexes.map(evidenceId),
    }),
    omittedGroups: compact.o.map((group) => Array.isArray(group) ? { title: group[0], reason: group[1], evidenceIds: group[2].map(evidenceId) } : { title: group.title, reason: group.reason, evidenceIds: group.evidenceIndexes.map(evidenceId) }),
    unclassifiedEvidenceIds: compact.u.map(evidenceId),
    focus: compact.f === undefined ? undefined : Object.fromEntries(Object.entries(compact.f).map(([reference, ranges]) => [evidenceId(reference), ranges.map(([start, end]) => ({ start, end }))])),
    testExecution: compact.x === undefined ? undefined : compact.x.map(([command, outcome, summary, source]) => ({ command, outcome, summary, source })),
  });
}

function normalizeAgentAnalysisDocument(document: z.infer<typeof AgentAnalysisDocumentSchema>, input: CollectedReviewInput): AnalysisDocument {
  return AnalysisDocumentSchema.parse({
    summary: document.summary,
    chapters: document.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      kind: chapter.kind,
      synopsis: chapter.synopsis,
      before: chapter.before ?? undefined,
      after: chapter.after ?? undefined,
      confidence: chapter.confidence,
      attention: chapter.attention,
      riskCategories: chapter.riskCategories,
      evidenceIds: chapter.evidenceIndexes.map((index) => evidenceIdAtIndex(input, index)),
    })),
    steps: document.steps.map((step) => ({
      id: step.id,
      title: step.title,
      goal: step.goal,
      youNowHave: step.youNowHave,
      deferred: step.deferred.map((item) => ({ concern: item.concern, resolvedByStepId: item.resolvedByStepId ?? undefined })),
      dependsOn: step.dependsOn,
      forwardRefs: normalizeForwardRefs(step.id, step.forwardRefs),
      advancesChapterIds: step.advancesChapterIds,
      evidenceIds: step.evidenceIndexes.map((index) => evidenceIdAtIndex(input, index)),
    })),
    omittedGroups: document.omittedGroups.map((group) => ({
      title: group.title,
      reason: group.reason,
      evidenceIds: group.evidenceIndexes.map((index) => evidenceIdAtIndex(input, index)),
    })),
    unclassifiedEvidenceIds: document.unclassifiedEvidenceIndexes.map((index) => evidenceIdAtIndex(input, index)),
    focus: normalizeFocus(document.focus, input),
    testExecution: document.testExecution,
  });
}

function evidenceIdAtIndex(input: CollectedReviewInput, index: number): string {
  const hunk = input.hunks[index];
  if (hunk === undefined) throw new Error(`Evidence index ${index} is outside the review input manifest.`);
  return hunk.id;
}

function normalizeForwardRefs(stepId: string, refs: Array<{ symbol: string; introducedByStepId: string }>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const ref of refs) {
    if (normalized[ref.symbol] !== undefined) throw new Error(`Analysis step ${stepId} declares forward reference ${ref.symbol} more than once.`);
    normalized[ref.symbol] = ref.introducedByStepId;
  }
  return normalized;
}

function normalizeFocus(focus: Array<{ evidenceIndex: number; ranges: Array<{ startLine: number; endLine: number }> }> | undefined, input: CollectedReviewInput): AnalysisDocument["focus"] {
  if (focus === undefined) return undefined;
  const normalized: NonNullable<AnalysisDocument["focus"]> = {};
  for (const entry of focus) {
    const evidenceId = evidenceIdAtIndex(input, entry.evidenceIndex);
    if (normalized[evidenceId] !== undefined) throw new Error(`Focus declares evidence index ${entry.evidenceIndex} more than once.`);
    normalized[evidenceId] = entry.ranges.map((range) => ({ start: range.startLine, end: range.endLine }));
  }
  return normalized;
}

function isFullShaped(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && ("summary" in value || "chapters" in value || "steps" in value);
}

function isAgentShaped(value: unknown): value is Record<string, unknown> {
  if (!isFullShaped(value)) return false;
  if ("unclassifiedEvidenceIndexes" in value) return true;
  const objectValue = value as Record<string, unknown>;
  const collections = [objectValue["chapters"], objectValue["steps"], objectValue["omittedGroups"]];
  return collections.some((collection) => Array.isArray(collection) && collection.some((item) => item !== null && typeof item === "object" && "evidenceIndexes" in item));
}

function formatSchemaIssues(error: z.ZodError): string {
  const issues = collectSchemaIssues(error).slice(0, 8);
  return issues.length === 0
    ? "document: Invalid input"
    : issues.map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`).join("; ");
}

function collectSchemaIssues(error: z.ZodError, prefix: Array<string | number> = []): Array<{ path: Array<string | number>; message: string }> {
  const messages: Array<{ path: Array<string | number>; message: string }> = [];
  for (const issue of error.issues) {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union") {
      const nested = issue.unionErrors.flatMap((unionError) => collectSchemaIssues(unionError, path));
      const specific = nested.filter((candidate) => candidate.path.length > path.length);
      messages.push(...(specific.length > 0 ? specific : nested));
    } else {
      messages.push({ path, message: issue.message });
    }
  }
  return messages;
}

function hunkPatchText(hunk: CollectedReviewInput["hunks"][number]): string {
  const markers = { context: " ", addition: "+", deletion: "-" } as const;
  const oldCount = hunk.lines.filter((line) => line.kind !== "addition").length;
  const newCount = hunk.lines.filter((line) => line.kind !== "deletion").length;
  return [`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`, ...hunk.lines.map((line) => `${markers[line.kind]}${line.content}`)].join("\n");
}

function compactHunk(hunk: CollectedReviewInput["hunks"][number], path: string | undefined, patch: string | undefined, index: number) {
  const additions = hunk.lines.filter((line) => line.kind === "addition");
  const deletions = hunk.lines.filter((line) => line.kind === "deletion");
  const context = hunk.lines.length - additions.length - deletions.length;
  // Samples anchor manifest indexes to recognizable content; the agent reads the inline
  // patch or inspects the real one for detail, so two short previews per hunk are enough.
  const sampleLines = deletions.length > 0 && additions.length > 0 ? [deletions[0], additions[0]] : [...deletions, ...additions].slice(0, 2);
  const changedLineSamples = sampleLines.map((line) => ({
    kind: line.kind,
    oldLine: line.oldLine,
    newLine: line.newLine,
    preview: line.content.trim().slice(0, 100),
  }));
  return {
    index,
    fileId: hunk.fileId,
    path,
    oldStart: hunk.oldStart,
    newStart: hunk.newStart,
    lineCount: hunk.lines.length,
    additions: additions.length,
    deletions: deletions.length,
    context,
    patch,
    changedLineSamples,
  };
}

function compactConversation(conversation: ConversationContext | undefined) {
  if (conversation === undefined) return undefined;
  const messages = conversation.messages.slice(-16).map((message) => ({
    role: message.role,
    timestamp: message.timestamp,
    excerpt: compactText(message.text, 1_500),
  }));
  return {
    source: conversation.source,
    messageCount: conversation.messages.length,
    excerptedMessages: messages,
  };
}

function compactText(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const head = normalized.slice(0, Math.floor(limit * 0.7)).trimEnd();
  const tail = normalized.slice(-Math.floor(limit * 0.25)).trimStart();
  return `${head} ... ${tail}`;
}

function diffRange(input: CollectedReviewInput): string {
  if (input.includesWorkingTree) return input.mergeBase;
  return `${input.mergeBase} ${input.targetRef}`;
}

export function extractJson(text: string): string {
  // Agents sometimes narrate around the document, including other fenced snippets;
  // take the first fence that holds an object, then fall back to the first balanced
  // object in the raw text before giving up.
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    const block = (match[1] ?? "").trim();
    if (block.startsWith("{")) return balancedJsonObject(block) ?? block;
  }
  const start = text.indexOf("{");
  if (start === -1) return text.trim();
  const candidate = text.slice(start);
  return balancedJsonObject(candidate) ?? candidate.trim();
}

/** Cuts the candidate at the brace closing its leading object, ignoring braces inside JSON strings, so trailing narration never corrupts the parse. */
function balancedJsonObject(candidate: string): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return candidate.slice(0, index + 1);
    }
  }
  return undefined;
}
