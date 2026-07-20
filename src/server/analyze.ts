import type { CollectedReviewInput } from "./git.js";
import type { ConversationContext } from "./conversation.js";
import type { AgentClient, ReviewAgent, TurnActivity } from "./agent.js";
import { analysisPrompt, extractJson, parseAnalysisDocument } from "./analysis-core.js";
import { activitySnapshot, responseMetadata as makeResponseMetadata, textMetadata, type AnalysisAttemptTrace, type AnalysisFailureTrace } from "./diagnostic.js";
import type { DiagnosticResponseMetadata, DiagnosticValidation } from "../shared/diagnostic-schema.js";

export { analysisPrompt, buildPromptReviewInput, parseAnalysisDocument } from "./analysis-core.js";

const REPAIR_ATTEMPTS = 2;

export interface AnalysisProgress {
  onActivity?: (activity: TurnActivity) => void;
  onRepair?: (attempt: number, attempts: number, problem: string) => void;
}

export class AnalysisFailure extends Error {
  constructor(message: string, readonly trace: AnalysisFailureTrace) {
    super(message);
    this.name = "AnalysisFailure";
  }
}

export class AnalysisResponseError extends Error {
  constructor(
    readonly phase: DiagnosticValidation["phase"],
    readonly response: string,
    readonly extracted: string,
    readonly metadata: DiagnosticResponseMetadata,
    message: string,
  ) {
    super(message);
    this.name = "AnalysisResponseError";
  }
}

export async function analyzeWithAgent(agent: ReviewAgent, input: CollectedReviewInput, conversation?: ConversationContext, progress?: AnalysisProgress) {
  const prompt = analysisPrompt(input, conversation);
  const attempts: AnalysisAttemptTrace[] = [];
  try {
    return await withFreshClientRetry(agent, async (client) => {
      const thread = await client.startTextThread(input.repoPath);
      try {
        let response = await sendAnalysisTurn(thread, prompt, "initial", attempts, progress);
        let lastError = "";
        for (let attempt = 0; attempt <= REPAIR_ATTEMPTS; attempt += 1) {
          try {
            return parseAnalysisResponse(response, input, attempt === REPAIR_ATTEMPTS ? "salvage" : "require");
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            recordValidationFailure(attempts.at(-1), error);
            if (attempt === REPAIR_ATTEMPTS) break;
            progress?.onRepair?.(attempt + 1, REPAIR_ATTEMPTS, lastError);
            response = await sendAnalysisTurn(thread, analysisRepairPrompt(lastError), "repair", attempts, progress);
          }
        }
        throw new AnalysisFailure(`${agent.name} produced an analysis that still failed validation after ${REPAIR_ATTEMPTS} repair turns: ${lastError}`, {
          phase: "analysis",
          message: lastError,
          attempts,
        });
      } finally {
        await thread.close();
      }
    });
  } catch (error) {
    if (error instanceof AnalysisFailure) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AnalysisFailure(`${agent.name} analysis failed: ${message}`, { phase: "analysis", message, attempts });
  }
}

async function sendAnalysisTurn(
  thread: Awaited<ReturnType<AgentClient["startTextThread"]>>,
  prompt: string,
  kind: AnalysisAttemptTrace["kind"],
  attempts: AnalysisAttemptTrace[],
  progress: AnalysisProgress | undefined,
): Promise<string> {
  const trace: AnalysisAttemptTrace = { kind, durationMs: 0, prompt: textMetadata(prompt) };
  attempts.push(trace);
  const startedAt = Date.now();
  let latestActivity: TurnActivity | undefined;
  try {
    const response = await thread.send(prompt, (activity) => {
      latestActivity = activity;
      progress?.onActivity?.(activity);
    });
    trace.durationMs = Date.now() - startedAt;
    trace.activity = activitySnapshot(latestActivity);
    trace.response = makeResponseMetadata(response, extractJson(response));
    trace.rawResponse = response;
    return response;
  } catch (error) {
    trace.durationMs = Date.now() - startedAt;
    trace.activity = activitySnapshot(latestActivity);
    trace.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

function recordValidationFailure(trace: AnalysisAttemptTrace | undefined, error: unknown): void {
  if (trace === undefined) return;
  if (error instanceof AnalysisResponseError) {
    trace.validation = { phase: error.phase, message: error.message };
  } else {
    trace.error = error instanceof Error ? error.message : String(error);
  }
}

/** Parses one complete agent response while retaining which boundary failed for repair and CLI diagnostics. */
export function parseAnalysisResponse(response: string, input: CollectedReviewInput, focus: "require" | "salvage" = "require") {
  const extracted = extractJson(response);
  const metadata = makeResponseMetadata(response, extracted);
  let value: unknown;
  try {
    value = JSON.parse(extracted);
  } catch (error) {
    throw new AnalysisResponseError("json-parsing", response, extracted, metadata, `JSON parsing failed: ${jsonParseDiagnostic(error)} Response metadata: ${responseMetadataSummary(metadata)}.`);
  }

  try {
    return parseAnalysisDocument(value, input, { focus });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const validationPhase = reason.startsWith("Analysis document did not match") ? "wire-validation" : "review-validation";
    const phase = validationPhase === "wire-validation" ? "wire document validation" : "review invariant validation";
    throw new AnalysisResponseError(validationPhase, response, extracted, metadata, `${phase} failed: ${reason} Response metadata: ${responseMetadataSummary(metadata)}.`);
  }
}

export function analysisRepairPrompt(problem: string): string {
  return `Your prior response failed during analysis document validation. Fix the specific problem below and return only one valid JSON object in the explicit named-object format; do not return Markdown, commentary, short keys, positional arrays, or a partial document.

Problem: ${problem}

Use these top-level properties: summary, chapters, steps, omittedGroups, unclassifiedEvidenceIndexes, and optional focus and testExecution. Every chapter, step, omitted group, focus entry, and test execution is an object with the explicit property names described in the initial prompt. A step's deferred items are {concern,resolvedByStepId}, where resolvedByStepId may be null or omitted; forwardRefs is [{symbol,introducedByStepId}]; focus is [{evidenceIndex,ranges:[{startLine,endLine}]}]. Evidence references are zero-based integer indexes into the original review input manifest, never hunk ID strings. Use only manifest indexes, preserve valid fields, and correct every issue named above.`;
}

function responseMetadataSummary(metadata: DiagnosticResponseMetadata): string {
  return `response ${metadata.length} characters; extracted candidate ${metadata.extractedLength} characters; fenced=${metadata.fenced}; candidateStartsWithObject=${metadata.candidateStartsWithObject}`;
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
    if (error instanceof AnalysisFailure) throw error;
    if (!TRANSIENT_AGENT_FAILURE.test(error instanceof Error ? error.message : String(error))) throw error;
    try {
      return await attempt();
    } catch (retryError) {
      throw new Error(`${retryError instanceof Error ? retryError.message : String(retryError)} (already retried once with a fresh ${agent.name} client)`);
    }
  }
}
