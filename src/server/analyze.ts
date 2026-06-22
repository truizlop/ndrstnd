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
  const document = AnalysisDocumentSchema.parse(value);
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
  const evidence = input.hunks.map((hunk) => ({ id: hunk.id, path: input.files.find((file) => file.id === hunk.fileId)?.path, lines: hunk.lines })).slice(0, 120);
  return `You are ndrstnd, a comprehension assistant. Explain a branch without critiquing it or proposing changes. ${lensInstructions ?? "Prioritize the implementation story and behavior changes."} Return JSON only with this shape: {summary,chapters:[{id,title,kind,synopsis,before?,after?,confidence,attention,riskCategories,evidenceIds}],omittedGroups:[{title,reason,evidenceIds}],unclassifiedEvidenceIds}. Allowed kind values are exactly feature, decision, behavior, non_functional, risk, test, other. Confidence is high, medium, or low. Attention is low, contained, elevated, high, or critical. Risk categories are formatting, refactor, behavior, performance, security. Use only listed evidence IDs. Every meaningful evidence ID must appear exactly once in chapters, omittedGroups, or unclassifiedEvidenceIds.\n\nReview input:\n${JSON.stringify({ target: input.targetRef, mergeBase: input.mergeBase, files: input.files, evidence, conversation: conversation?.messages })}`;
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

const QuestionAnswerSchema = z.object({ answer: z.string().min(1), provenance: z.enum(["branch", "conversation", "both", "general"]) });

export async function answerQuestionWithCodex(input: CollectedReviewInput, conversation: ConversationContext | undefined, selection: string, question: string): Promise<z.infer<typeof QuestionAnswerSchema>> {
  const client = new CodexAppServerClient();
  try {
    const text = await client.runTextTurn(input.repoPath, `You are ndrstnd. Answer this comprehension question without judging the code or proposing changes. Return JSON only: {answer,provenance}. provenance must be branch, conversation, both, or general. Mark general only if the answer is not based on the provided local evidence or conversation.\n\nSelected diff text:\n${selection}\n\nQuestion:\n${question}\n\nRepository evidence:\n${JSON.stringify(input.hunks.slice(0, 80))}\n\nConversation:\n${JSON.stringify(conversation?.messages)}`);
    return QuestionAnswerSchema.parse(JSON.parse(extractJson(text)));
  } finally {
    client.close();
  }
}

function extractJson(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return (fenced?.[1] ?? text).trim();
}
