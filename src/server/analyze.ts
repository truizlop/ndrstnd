import { z } from "zod";
import type { CollectedReviewInput } from "./git.js";
import type { ConversationContext } from "./conversation.js";
import { CodexAppServerClient } from "./codex.js";
import { analysisPrompt, buildPromptReviewInput, extractJson, parseAnalysisDocument } from "./analysis-core.js";

export { analysisPrompt, buildFallbackAnalysis, buildPromptReviewInput, parseAnalysisDocument } from "./analysis-core.js";

export async function analyzeWithCodex(input: CollectedReviewInput, conversation?: ConversationContext, onDelta?: (delta: string) => void, lensInstructions?: string) {
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
