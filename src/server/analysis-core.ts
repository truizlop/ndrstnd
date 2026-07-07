import type { AnalysisDocument } from "../shared/analysis-schema.js";
import { AnalysisDocumentSchema } from "../shared/analysis-schema.js";
import { z } from "zod";
import type { CollectedReviewInput } from "./git.js";
import type { ConversationContext } from "./conversation.js";
import { deriveEvidenceOrder } from "./evidence-ordering.js";

export function parseAnalysisDocument(value: unknown, input: CollectedReviewInput, options?: { focus?: "require" | "salvage" }): AnalysisDocument {
  const document = parseWireAnalysisDocument(value);
  const knownEvidence = new Set(input.hunks.map((hunk) => hunk.id));
  const referenced = new Set<string>();
  for (const chapter of document.chapters) for (const id of chapter.evidenceIds) referenced.add(id);
  for (const group of document.omittedGroups) for (const id of group.evidenceIds) referenced.add(id);
  for (const id of document.unclassifiedEvidenceIds) referenced.add(id);
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
      throw new Error(`Analysis step order violates symbol ${constraint.symbol}: ${before.id} must come before ${after.id}. Reorder the steps, or declare forwardRefs {"${constraint.symbol}":"${before.id}"} on ${after.id} if the forward use is intentional.`);
    }
  }
}

export function analysisPrompt(input: CollectedReviewInput, conversation?: ConversationContext, lensInstructions?: string): string {
  const reviewInput = buildPromptReviewInput(input, conversation);
  return `You are ndrstnd, a comprehension assistant. Explain a branch without critiquing it or proposing changes. ${lensInstructions ?? "Prioritize the implementation story and behavior changes."} Return compact minified JSON only with this shape: {s,c:[[id,title,kind,synopsis,before|null,after|null,confidence,attention,riskCategories,evidenceIds]],t:[[id,title,goal,youNowHave,[[concern,resolvedByStepId|null]],dependsOn,forwardRefs,advancesChapterIds,evidenceIds]],o:[[title,reason,evidenceIds]],u:[evidenceId],f:{evidenceId:[[startLine,endLine]]}}. Allowed kind values are exactly feature, decision, behavior, non_functional, risk, test, other. Confidence is high, medium, or low. Attention is low, contained, elevated, high, or critical. Risk categories are formatting, refactor, behavior, performance, security. Use only listed evidence IDs. Every meaningful evidence ID must appear exactly once in c, o, or u, and exactly once in t. Group every low-signal evidence ID into an omitted group in o with a concise reason such as lockfile churn or generated output; u is a last resort for evidence that truly cannot be classified. f drives the Evidence zoom excerpts: for every evidence ID used in c, list 1-3 [startLine,endLine] ranges of new-file line numbers marking the exact lines a reviewer must read first - the load-bearing statements, not whole hunks, imports, or boilerplate. Each range must fall inside that hunk's new-file lines; inspect the patch to choose them precisely.

Prose depth is validated and out-of-range fields are rejected, so hit these word counts: summary 35-75 words; each synopsis 20-55 words across two or three sentences explaining what changed, how it works, and why it matters; before and after 10-40 words each describing concrete observable behavior; each step goal 12-40 words stating the intent and mechanism; each youNowHave 12-40 words stating the capability that now exists. Titles stay under 10 words. Name the actual functions, types, and files involved. Never answer with a single vague sentence, and never pad - every sentence must add information a reviewer can act on.

Timeline steps are a rational reconstruction of how to build this branch. They are not commit chronology, file order, or the Story chapters repeated. Each step must be one capability increment; explain its intent in goal, its postcondition in youNowHave, intentionally postponed concerns in deferred, earlier step ids in dependsOn, unavoidable forward symbol uses in forwardRefs as {"Symbol":"later-step-id"}, the Story chapters it advances, and its evidence IDs. The manifest's construction.defineBeforeUse entries are hard ordering rules: each symbol must be defined in the same or an earlier step than its use, or the using step must declare it in forwardRefs. construction.suggestedEvidenceOrder is one valid linearization you may regroup into steps.

When the review input includes conversation, it is the dialogue between the user and the coding agent that produced this branch. Treat it as primary evidence of intent: explain why changes were made, which alternatives were considered or rejected, and which incidents, requirements, or downstream consumers motivated them, weaving those stated reasons into the summary, chapter synopses, before/after, step goals, and deferred concerns instead of guessing intent from the code alone. Attribute reasons faithfully - never invent motives the conversation does not support, and never copy credentials or secrets from it. When conversation is absent, ground every claim in the diff and repository alone.

You are running in the reviewed repository with a read-only sandbox. The review input below is a compact manifest, not the full patch. Use its file paths, hunk IDs, line anchors, and suggested git commands to inspect only the code you need for a high-quality comprehension story. Prefer grouping related evidence IDs by behavior or decision instead of mirroring path order.

Review input:
${JSON.stringify(reviewInput)}`;
}

export function buildPromptReviewInput(input: CollectedReviewInput, conversation?: ConversationContext) {
  const filesById = new Map(input.files.map((file) => [file.id, file]));
  const hunksByFile = new Map<string, Array<ReturnType<typeof compactHunk>>>();
  for (const hunk of input.hunks) {
    const file = filesById.get(hunk.fileId);
    const compact = compactHunk(hunk, file?.path);
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
      note: "For untracked working-tree files, inspect the current file directly and use the manifest hunk anchors as evidence IDs.",
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
      suggestedEvidenceOrder: evidenceOrder.orderedEvidenceIds,
      defineBeforeUse: evidenceOrder.constraints
        .filter((constraint) => constraint.reason === "symbol")
        .map((constraint) => ({ symbol: constraint.symbol, definedIn: constraint.beforeEvidenceId, usedIn: constraint.afterEvidenceId })),
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
  z.string().min(1).max(420),
  z.string().max(300).nullable(),
  z.string().max(300).nullable(),
  ConfidenceSchema,
  z.enum(["low", "contained", "elevated", "high", "critical"]),
  z.array(CompactRiskCategorySchema),
  z.array(z.string().min(1)).min(1),
]);
const CompactStepSchema = z.tuple([
  z.string().min(1).max(80),
  z.string().min(1).max(120),
  z.string().min(1).max(320),
  z.string().min(1).max(320),
  z.array(z.tuple([z.string().min(1).max(220), z.string().min(1).max(80).nullable()])),
  z.array(z.string().min(1).max(80)),
  z.record(z.string().min(1), z.string().min(1).max(80)),
  z.array(z.string().min(1).max(80)).min(1),
  z.array(z.string().min(1)).min(1),
]);

const CompactAnalysisDocumentSchema = z.object({
  s: z.string().min(1).max(560),
  c: z.array(CompactChapterSchema),
  t: z.array(CompactStepSchema),
  o: z.array(z.tuple([z.string().min(1).max(120), z.string().min(1).max(220), z.array(z.string().min(1)).min(1)])),
  u: z.array(z.string().min(1)),
  f: z.record(z.string().min(1), z.array(z.tuple([z.number().int().min(1), z.number().int().min(1)])).min(1).max(5)).optional(),
});

function parseWireAnalysisDocument(value: unknown): AnalysisDocument {
  const full = AnalysisDocumentSchema.safeParse(value);
  if (full.success) return full.data;

  const compact = CompactAnalysisDocumentSchema.parse(value);
  return AnalysisDocumentSchema.parse({
    summary: compact.s,
    chapters: compact.c.map((chapter) => ({
      id: chapter[0],
      title: chapter[1],
      kind: chapter[2],
      synopsis: chapter[3],
      before: chapter[4] ?? undefined,
      after: chapter[5] ?? undefined,
      confidence: chapter[6],
      attention: chapter[7],
      riskCategories: chapter[8],
      evidenceIds: chapter[9],
    })),
    steps: compact.t.map((step) => ({
      id: step[0],
      title: step[1],
      goal: step[2],
      youNowHave: step[3],
      deferred: step[4].map((item) => ({ concern: item[0], resolvedByStepId: item[1] ?? undefined })),
      dependsOn: step[5],
      forwardRefs: step[6],
      advancesChapterIds: step[7],
      evidenceIds: step[8],
    })),
    omittedGroups: compact.o.map((group) => ({ title: group[0], reason: group[1], evidenceIds: group[2] })),
    unclassifiedEvidenceIds: compact.u,
    focus: compact.f === undefined ? undefined : Object.fromEntries(Object.entries(compact.f).map(([evidenceId, ranges]) => [evidenceId, ranges.map(([start, end]) => ({ start, end }))])),
  });
}

function compactHunk(hunk: CollectedReviewInput["hunks"][number], path: string | undefined) {
  const additions = hunk.lines.filter((line) => line.kind === "addition");
  const deletions = hunk.lines.filter((line) => line.kind === "deletion");
  const context = hunk.lines.length - additions.length - deletions.length;
  // Samples only anchor hunk IDs to recognizable content; Codex inspects the
  // real patch for detail, so two short previews per hunk are enough.
  const sampleLines = deletions.length > 0 && additions.length > 0 ? [deletions[0], additions[0]] : [...deletions, ...additions].slice(0, 2);
  const changedLineSamples = sampleLines.map((line) => ({
    kind: line.kind,
    oldLine: line.oldLine,
    newLine: line.newLine,
    preview: line.content.trim().slice(0, 100),
  }));
  return {
    id: hunk.id,
    fileId: hunk.fileId,
    path,
    oldStart: hunk.oldStart,
    newStart: hunk.newStart,
    lineCount: hunk.lines.length,
    additions: additions.length,
    deletions: deletions.length,
    context,
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
  if (input.includesWorkingTree) return input.baseRef === "empty" ? input.mergeBase : input.baseRef;
  return `${input.mergeBase}...${input.targetRef}`;
}

export function extractJson(text: string): string {
  // Codex sometimes narrates around the document; accept a fenced block anywhere,
  // then fall back to the outermost braces before giving up on the raw text.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  if (candidate.startsWith("{")) return candidate;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start !== -1 && end > start ? candidate.slice(start, end + 1).trim() : candidate;
}
