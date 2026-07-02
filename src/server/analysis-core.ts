import type { AnalysisDocument } from "../shared/analysis-schema.js";
import { AnalysisDocumentSchema } from "../shared/analysis-schema.js";
import { z } from "zod";
import type { CollectedReviewInput } from "./git.js";
import type { ConversationContext } from "./conversation.js";

export function buildFallbackAnalysis(input: CollectedReviewInput): AnalysisDocument {
  const filesById = new Map(input.files.map((file) => [file.id, file]));
  const meaningful = input.hunks.filter((hunk) => filesById.get(hunk.fileId)?.signal === "meaningful");
  const lowSignal = input.hunks.filter((hunk) => filesById.get(hunk.fileId)?.signal === "low-signal");
  const groups = new Map<string, ReturnType<typeof fallbackGroupForHunk> & { evidenceIds: string[] }>();
  for (const hunk of meaningful) {
    const group = fallbackGroupForHunk(hunk, filesById.get(hunk.fileId)?.path);
    const existing = groups.get(group.id);
    if (existing === undefined) groups.set(group.id, { ...group, evidenceIds: [hunk.id] });
    else existing.evidenceIds.push(hunk.id);
  }
  const chapters = [...groups.values()].map((group) => ({
    id: group.id,
    title: group.title,
    kind: group.kind,
    synopsis: group.synopsis,
    confidence: "low" as const,
    attention: group.attention,
    riskCategories: group.riskCategories,
    evidenceIds: group.evidenceIds,
  }));
  return {
    summary: fallbackSummary(input.files.length, chapters.map((chapter) => chapter.title)),
    chapters,
    omittedGroups: lowSignal.length === 0 ? [] : [{ title: "Low-signal changes", reason: "Automatically classified as generated, binary, vendor, or lockfile content.", evidenceIds: lowSignal.map((hunk) => hunk.id) }],
    unclassifiedEvidenceIds: [],
  };
}

function fallbackGroupForHunk(hunk: CollectedReviewInput["hunks"][number], path: string | undefined) {
  const normalizedPath = (path ?? "").toLowerCase();
  const changedText = hunk.lines.filter((line) => line.kind !== "context").map((line) => line.content).join("\n").toLowerCase();

  if (/(^|\/)(?:test|tests|__snapshots__)\//.test(normalizedPath) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalizedPath) || /\b(?:expect|it|test|describe)\s*\(/.test(changedText)) {
    return {
      id: "test-coverage",
      title: "Test coverage",
      kind: "test" as const,
      synopsis: "Tests and snapshots describe the intended behavior changes.",
      attention: "low" as const,
      riskCategories: ["behavior" as const],
    };
  }

  if (/src\/web|artifact|page|story|zoom|chapter|timeline|diff/.test(normalizedPath) || /\b(?:story|zoom|chapter|artifact|render|snapshot)\b/.test(changedText)) {
    return {
      id: "review-presentation",
      title: "Review presentation",
      kind: "behavior" as const,
      synopsis: "The static review artifact changes how the story, evidence, and actions are presented.",
      attention: "contained" as const,
      riskCategories: ["behavior" as const],
    };
  }

  if (/src\/server\/git|gitreader|worktree|merge-base|mergebase|diff/.test(normalizedPath) || /\b(?:worktree|mergebase|merge-base|baseRef|targetRef|git diff|untracked|staged)\b/i.test(changedText)) {
    return {
      id: "review-input-collection",
      title: "Review input collection",
      kind: "behavior" as const,
      synopsis: "Review input collection changes how Git ranges and working-tree evidence are gathered.",
      attention: "contained" as const,
      riskCategories: ["behavior" as const],
    };
  }

  if (/src\/server\/(?:analyze|codex|conversation)|prompt|analysis/.test(normalizedPath) || /\b(?:prompt|analysis|codex|conversation|evidenceIds)\b/.test(changedText)) {
    return {
      id: "analysis-grouping",
      title: "Analysis grouping",
      kind: "behavior" as const,
      synopsis: "Analysis and prompt handling change how evidence becomes a readable review story.",
      attention: "contained" as const,
      riskCategories: ["behavior" as const],
    };
  }

  return {
    id: "implementation-support",
    title: "Implementation support",
    kind: "other" as const,
    synopsis: "Supporting source changes contribute to the reviewed behavior.",
    attention: "contained" as const,
    riskCategories: ["refactor" as const],
  };
}

function fallbackSummary(fileCount: number, titles: string[]): string {
  if (titles.length === 0) return `${fileCount} changed files are ready for review.`;
  const visible = titles.slice(0, 3);
  const tail = titles.length > visible.length ? `, and ${titles.length - visible.length} more area${titles.length - visible.length === 1 ? "" : "s"}` : "";
  return `The branch changes ${formatList(visible.map((title) => title.toLowerCase()))}${tail} across ${fileCount} file${fileCount === 1 ? "" : "s"}.`;
}

function formatList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
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
  if (input.includesWorkingTree) return input.baseRef === "empty" ? input.mergeBase : input.baseRef;
  return `${input.mergeBase}...${input.targetRef}`;
}

export function extractJson(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return (fenced?.[1] ?? text).trim();
}
