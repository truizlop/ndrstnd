import type { CollectedReviewInput } from "./git.js";
import type { ConversationContext } from "./conversation.js";
import type { AgentClient, ReviewAgent, TurnActivity } from "./agent.js";
import { analysisPrompt, extractJson, parseAnalysisDocument } from "./analysis-core.js";

export { analysisPrompt, buildPromptReviewInput, parseAnalysisDocument } from "./analysis-core.js";

const REPAIR_ATTEMPTS = 2;

export interface AnalysisProgress {
  onActivity?: (activity: TurnActivity) => void;
  onRepair?: (attempt: number, attempts: number, problem: string) => void;
}

export async function analyzeWithAgent(agent: ReviewAgent, input: CollectedReviewInput, conversation?: ConversationContext, progress?: AnalysisProgress) {
  const prompt = analysisPrompt(input, conversation);
  return withFreshClientRetry(agent, async (client) => {
    const thread = await client.startTextThread(input.repoPath);
    try {
      let response = await thread.send(prompt, progress?.onActivity);
      let lastError = "";
      for (let attempt = 0; attempt <= REPAIR_ATTEMPTS; attempt += 1) {
        try {
          return parseAnalysisResponse(response, input, attempt === REPAIR_ATTEMPTS ? "salvage" : "require");
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          if (attempt === REPAIR_ATTEMPTS) break;
          progress?.onRepair?.(attempt + 1, REPAIR_ATTEMPTS, lastError);
          response = await thread.send(analysisRepairPrompt(lastError), progress?.onActivity);
        }
      }
      throw new Error(`${agent.name} produced an analysis that still failed validation after ${REPAIR_ATTEMPTS} repair turns: ${lastError}`);
    } finally {
      await thread.close();
    }
  });
}

/** Parses one complete agent response while retaining which boundary failed for repair and CLI diagnostics. */
export function parseAnalysisResponse(response: string, input: CollectedReviewInput, focus: "require" | "salvage" = "require") {
  const extracted = extractJson(response);
  let value: unknown;
  try {
    value = JSON.parse(extracted);
  } catch (error) {
    throw new Error(`JSON parsing failed: ${jsonParseDiagnostic(error)} Response metadata: ${responseMetadata(response, extracted)}.`);
  }

  try {
    return parseAnalysisDocument(value, input, { focus });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const phase = reason.startsWith("Analysis document did not match") ? "wire document validation" : "review invariant validation";
    throw new Error(`${phase} failed: ${reason} Response metadata: ${responseMetadata(response, extracted)}.`);
  }
}

export function analysisRepairPrompt(problem: string): string {
  return `Your prior response failed during analysis document validation. Fix the specific problem below and return only one valid minified JSON object; do not return Markdown, commentary, or a partial document.

Problem: ${problem}

The compact shape is {s,c:[[id,title,kind,synopsis,before|null,after|null,confidence,attention,riskCategories,evidenceIds]],t:[[id,title,goal,youNowHave,[[concern,resolvedByStepId|null]],dependsOn,forwardRefs,advancesChapterIds,evidenceIds]],o:[[title,reason,evidenceIds]],u:[evidenceId],f:{evidenceId:[[startLine,endLine]]},x:[[command,outcome,summary,source]]}. In c, position 3 is kind and may be feature, decision, behavior, non_functional, risk, test, or other; position 9 is riskCategories and may contain only formatting, refactor, behavior, performance, or security. Use only evidence IDs from the original review input manifest, preserve valid fields, and correct every issue named above.`;
}

function responseMetadata(response: string, extracted: string): string {
  return `response ${response.length} characters; extracted candidate ${extracted.length} characters; fenced=${response.includes("```")}; candidateStartsWithObject=${extracted.trimStart().startsWith("{")}`;
}

function jsonParseDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const token = message.match(/Unexpected token[^,]*/)?.[0];
  const position = message.match(/at position \d+/)?.[0];
  return [token, position].filter((part): part is string => part !== undefined).join(" ") || "invalid JSON document";
}

/** One reviewer-facing liveness line, printed on an interval so a long quiet analysis is never mistaken for a hang. */
export function formatAnalysisHeartbeat(agentName: string, elapsedMs: number, activity: TurnActivity | undefined, sinceActivityMs?: number): string {
  if (activity === undefined) return `still analyzing (${formatDuration(elapsedMs)}): waiting for the first ${agentName} event`;
  const draft = activity.draftCharacters > 0 ? `; ${formatCount(activity.draftCharacters)} draft characters` : "";
  const stale = sinceActivityMs !== undefined && sinceActivityMs >= 60_000 ? `; no new ${agentName} events for ${formatDuration(sinceActivityMs)}` : "";
  return `still analyzing (${formatDuration(elapsedMs)}): ${activity.label}${draft}${stale}`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

function formatCount(count: number): string {
  return count < 1_000 ? String(count) : `${(count / 1_000).toFixed(1)}k`;
}

const TRANSIENT_AGENT_FAILURE = /stalled|timed out|exited with status|app-server closed|could not run|not running/i;

async function withFreshClientRetry<T>(agent: ReviewAgent, run: (client: AgentClient) => Promise<T>): Promise<T> {
  const attempt = async (): Promise<T> => {
    const client = agent.createClient();
    try {
      return await run(client);
    } finally {
      client.close();
    }
  };
  try {
    return await attempt();
  } catch (error) {
    if (!TRANSIENT_AGENT_FAILURE.test(error instanceof Error ? error.message : String(error))) throw error;
    try {
      return await attempt();
    } catch (retryError) {
      throw new Error(`${retryError instanceof Error ? retryError.message : String(retryError)} (already retried once with a fresh ${agent.name} client)`);
    }
  }
}
