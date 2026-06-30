import type { AnalysisDocument } from "../shared/analysis-schema.js";
import { AnalysisDocumentSchema } from "../shared/analysis-schema.js";
import { z } from "zod";
import type { CollectedReviewInput } from "./git.js";
import type { ConversationContext } from "./conversation.js";
import { CodexAppServerClient } from "./codex.js";

export function buildFallbackAnalysis(input: CollectedReviewInput): AnalysisDocument {
  const filesById = new Map(input.files.map((file) => [file.id, file]));
  const meaningful = input.hunks.filter((hunk) => filesById.get(hunk.fileId)?.signal === "meaningful");
  const lowSignal = input.hunks.filter((hunk) => filesById.get(hunk.fileId)?.signal === "low-signal");
  const chapters = meaningful.map((hunk) => {
    const file = filesById.get(hunk.fileId);
    return {
      id: `raw-${hunk.id}`,
      title: file?.path ?? "Changed source",
      kind: "other" as const,
      synopsis: `Review the change in ${file?.path ?? "this source file"}. Semantic analysis is not available yet.`,
      confidence: "low" as const,
      attention: "contained" as const,
      riskCategories: ["refactor" as const],
      evidenceIds: [hunk.id],
    };
  });
  return {
    summary: `${input.files.length} changed files; ${meaningful.length} meaningful evidence hunks are ready for review.`,
    chapters,
    omittedGroups: lowSignal.length === 0 ? [] : [{ title: "Low-signal changes", reason: "Automatically classified as generated, binary, vendor, or lockfile content.", evidenceIds: lowSignal.map((hunk) => hunk.id) }],
    unclassifiedEvidenceIds: [],
  };
}

export function parseAnalysisDocument(value: unknown, input: CollectedReviewInput): AnalysisDocument {
  const document = parseWireAnalysisDocument(value);
  const knownEvidence = new Set(input.hunks.map((hunk) => hunk.id));
  const referenced = new Set<string>();
  for (const chapter of document.chapters) for (const id of chapter.evidenceIds) referenced.add(id);
  for (const group of document.omittedGroups) for (const id of group.evidenceIds) referenced.add(id);
  for (const id of document.unclassifiedEvidenceIds) referenced.add(id);
  for (const id of referenced) if (!knownEvidence.has(id)) throw new Error(`Analysis referenced unknown evidence: ${id}`);
  const meaningfulEvidence = input.hunks
    .filter((hunk) => input.files.find((file) => file.id === hunk.fileId)?.signal === "meaningful")
    .map((hunk) => hunk.id);
  const missing = meaningfulEvidence.filter((id) => !referenced.has(id));
  if (missing.length > 0) throw new Error(`Analysis did not account for meaningful evidence: ${missing.join(", ")}`);
  return document;
}

export function analysisPrompt(input: CollectedReviewInput, conversation?: ConversationContext, lensInstructions?: string): string {
  const reviewInput = buildPromptReviewInput(input, conversation);
  return `You are ndrstnd, a comprehension assistant. Explain a branch without critiquing it or proposing changes. ${lensInstructions ?? "Prioritize the implementation story and behavior changes."} Return compact minified JSON only with this shape: {s,c:[[id,title,kind,synopsis,before|null,after|null,confidence,attention,riskCategories,evidenceIds]],o:[[title,reason,evidenceIds]],u:[evidenceId]}. Keep summary under 45 words; title under 10 words; synopsis/before/after under 30 words each. Allowed kind values are exactly feature, decision, behavior, non_functional, risk, test, other. Confidence is high, medium, or low. Attention is low, contained, elevated, high, or critical. Risk categories are formatting, refactor, behavior, performance, security. Use only listed evidence IDs. Every meaningful evidence ID must appear exactly once in c, o, or u.

You are running in the reviewed repository with a read-only sandbox. The review input below is a compact manifest, not the full patch. Use its file paths, hunk IDs, line anchors, and suggested git commands to inspect only the code you need for a high-quality comprehension story. Prefer grouping related evidence IDs by behavior or decision instead of mirroring path order.

Review input:
${JSON.stringify(reviewInput)}`;
}

export async function analyzeWithCodex(input: CollectedReviewInput, conversation?: ConversationContext, onDelta?: (delta: string) => void, lensInstructions?: string): Promise<AnalysisDocument> {
  const client = new CodexAppServerClient();
  try {
    const prompt = analysisPrompt(input, conversation, lensInstructions);
    const text = await client.runTextTurn(input.repoPath, prompt, onDelta);
    try {
      return parseAnalysisDocument(JSON.parse(extractJson(text)), input);
    } catch (error) {
      const repair = await client.runTextTurn(input.repoPath, `${prompt}\n\nYour prior response failed validation: ${error instanceof Error ? error.message : String(error)}. Return a corrected JSON document only.`, onDelta);
      return parseAnalysisDocument(JSON.parse(extractJson(repair)), input);
    }
  } finally {
    client.close();
  }
}

const QuestionAnswerSchema = z.object({ answer: z.string().min(1).max(700), provenance: z.enum(["branch", "conversation", "both", "general"]) });

export async function answerQuestionWithCodex(input: CollectedReviewInput, conversation: ConversationContext | undefined, selection: string, question: string): Promise<z.infer<typeof QuestionAnswerSchema>> {
  const client = new CodexAppServerClient();
  try {
    const reviewInput = buildPromptReviewInput(input, conversation);
    const text = await client.runTextTurn(input.repoPath, `You are ndrstnd. Answer this comprehension question without judging the code or proposing changes. Return compact minified JSON only: {answer,provenance}. Keep answer under 120 words. provenance must be branch, conversation, both, or general. Mark general only if the answer is not based on the selected text, inspected branch files, compact manifest, or conversation excerpts.

You are running in the reviewed repository with a read-only sandbox. Use the manifest's suggested git commands if the selected text is not enough.

Selected diff text:
${selection}

Question:
${question}

Review input:
${JSON.stringify(reviewInput)}`);
    return QuestionAnswerSchema.parse(JSON.parse(extractJson(text)));
  } finally {
    client.close();
  }
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
  z.string().min(1).max(260),
  z.string().max(260).nullable(),
  z.string().max(260).nullable(),
  ConfidenceSchema,
  z.enum(["low", "contained", "elevated", "high", "critical"]),
  z.array(CompactRiskCategorySchema),
  z.array(z.string().min(1)).min(1),
]);

const CompactAnalysisDocumentSchema = z.object({
  s: z.string().min(1).max(320),
  c: z.array(CompactChapterSchema),
  o: z.array(z.tuple([z.string().min(1).max(120), z.string().min(1).max(220), z.array(z.string().min(1)).min(1)])),
  u: z.array(z.string().min(1)),
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
    omittedGroups: compact.o.map((group) => ({ title: group[0], reason: group[1], evidenceIds: group[2] })),
    unclassifiedEvidenceIds: compact.u,
  });
}

function compactHunk(hunk: CollectedReviewInput["hunks"][number], path: string | undefined) {
  const additions = hunk.lines.filter((line) => line.kind === "addition");
  const deletions = hunk.lines.filter((line) => line.kind === "deletion");
  const context = hunk.lines.length - additions.length - deletions.length;
  const changedLineSamples = [...deletions, ...additions].slice(0, 4).map((line) => ({
    kind: line.kind,
    oldLine: line.oldLine,
    newLine: line.newLine,
    preview: line.content.trim().slice(0, 140),
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
  if (input.targetRef === "WORKTREE") return input.baseRef === "empty" ? input.mergeBase : input.baseRef;
  return `${input.mergeBase}...${input.targetRef}`;
}

function extractJson(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return (fenced?.[1] ?? text).trim();
}
