import { z } from "zod";
import type { CollectedReviewInput } from "./git.js";
import type { ConversationContext } from "./conversation.js";
import { CodexAppServerClient } from "./codex.js";
import { analysisPrompt, buildPromptReviewInput, extractJson, parseAnalysisDocument } from "./analysis-core.js";

export { analysisPrompt, buildPromptReviewInput, parseAnalysisDocument } from "./analysis-core.js";

const REPAIR_ATTEMPTS = 2;

export async function analyzeWithCodex(input: CollectedReviewInput, conversation?: ConversationContext, onDelta?: (delta: string) => void, lensInstructions?: string) {
  const prompt = analysisPrompt(input, conversation, lensInstructions);
  return withFreshClientRetry(async (client) => {
    let response = await client.runTextTurn(input.repoPath, prompt, onDelta);
    let lastError = "";
    for (let attempt = 0; attempt <= REPAIR_ATTEMPTS; attempt += 1) {
      try {
        return parseAnalysisDocument(JSON.parse(extractJson(response)), input, { focus: attempt === REPAIR_ATTEMPTS ? "salvage" : "require" });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt === REPAIR_ATTEMPTS) break;
        response = await client.runTextTurn(input.repoPath, `${prompt}\n\nYour prior response failed validation: ${lastError} Return only the corrected JSON document, with every other field kept as it was.`, onDelta);
      }
    }
    throw new Error(`Codex produced an analysis that still failed validation after ${REPAIR_ATTEMPTS} repair turns: ${lastError}`);
  });
}

const TRANSIENT_CODEX_FAILURE = /stalled|timed out|exited with status|app-server closed|could not run|not running/i;

async function withFreshClientRetry<T>(run: (client: CodexAppServerClient) => Promise<T>): Promise<T> {
  const attempt = async (): Promise<T> => {
    const client = new CodexAppServerClient();
    try {
      return await run(client);
    } finally {
      client.close();
    }
  };
  try {
    return await attempt();
  } catch (error) {
    if (!TRANSIENT_CODEX_FAILURE.test(error instanceof Error ? error.message : String(error))) throw error;
    try {
      return await attempt();
    } catch (retryError) {
      throw new Error(`${retryError instanceof Error ? retryError.message : String(retryError)} (already retried once with a fresh Codex app-server)`);
    }
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
