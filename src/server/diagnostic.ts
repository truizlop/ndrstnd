import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ReviewAgent, TurnActivity } from "./agent.js";
import type { CollectedReviewInput } from "./git.js";
import {
  DIAGNOSTIC_ARTIFACT_VERSION,
  DiagnosticArtifactSchema,
  type DiagnosticActivity,
  type DiagnosticArtifact,
  type DiagnosticAttempt,
  type DiagnosticPhase,
  type DiagnosticResponseMetadata,
  type DiagnosticTextMetadata,
  type DiagnosticValidation,
} from "../shared/diagnostic-schema.js";

export interface AnalysisAttemptTrace {
  kind: "initial" | "repair";
  durationMs: number;
  prompt: DiagnosticTextMetadata;
  response?: DiagnosticResponseMetadata;
  activity?: DiagnosticActivity;
  validation?: DiagnosticValidation;
  error?: string;
  rawResponse?: string;
}

export interface AnalysisFailureTrace {
  phase: DiagnosticPhase;
  message: string;
  attempts: AnalysisAttemptTrace[];
}

export function textMetadata(value: string): DiagnosticTextMetadata {
  return { length: value.length, sha256: sha256(value) };
}

export function responseMetadata(response: string, extracted: string): DiagnosticResponseMetadata {
  return {
    ...textMetadata(response),
    extractedLength: extracted.length,
    extractedSha256: sha256(extracted),
    fenced: response.includes("```"),
    candidateStartsWithObject: extracted.trimStart().startsWith("{"),
  };
}

export function activitySnapshot(activity: TurnActivity | undefined): DiagnosticActivity | undefined {
  return activity === undefined ? undefined : { ...activity };
}

export interface DiagnosticArtifactOptions {
  directory: string;
  toolVersion: string;
  commandArgs: readonly string[];
  agent?: ReviewAgent;
  input?: CollectedReviewInput;
  failure: AnalysisFailureTrace;
  includeAgentOutput?: boolean;
  now?: Date;
}

/** Writes a shareable failure trace without persisting prompts, diffs, environment variables, or agent output by default. */
export async function writeDiagnosticArtifact(options: DiagnosticArtifactOptions): Promise<string> {
  const repoPath = options.input?.repoPath;
  const includeAgentOutput = options.includeAgentOutput === true;
  const rawAgentResponses = includeAgentOutput
    ? options.failure.attempts.flatMap((attempt, index) => attempt.rawResponse === undefined ? [] : [{ turn: index + 1, response: attempt.rawResponse }])
    : [];
  const artifact: DiagnosticArtifact = DiagnosticArtifactSchema.parse({
    kind: "ndrstnd-analysis-diagnostic",
    version: DIAGNOSTIC_ARTIFACT_VERSION,
    createdAt: (options.now ?? new Date()).toISOString(),
    tool: {
      version: options.toolVersion,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
    command: {
      name: "review",
      args: redactCommandArgs(options.commandArgs, repoPath),
    },
    agent: options.agent === undefined ? undefined : {
      id: options.agent.id,
      name: options.agent.name,
      command: options.agent.command,
    },
    scope: repoPath === undefined || options.input === undefined ? undefined : diagnosticScope(options.input),
    failure: {
      phase: options.failure.phase,
      message: redactText(options.failure.message, repoPath),
    },
    attempts: options.failure.attempts.map((attempt) => diagnosticAttempt(attempt, repoPath)),
    sensitiveDataIncluded: rawAgentResponses.length > 0,
    rawAgentResponses: rawAgentResponses.length === 0 ? undefined : rawAgentResponses,
    nextSteps: diagnosticNextSteps(),
  });

  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const filename = `ndrstnd-diagnostic-${fileTimestamp(artifact.createdAt)}-${randomUUID().slice(0, 8)}.json`;
  const path = join(options.directory, filename);
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return path;
}

export function formatDiagnosticInstructions(artifactPath: string | undefined, writeError?: string): string {
  const lines = ["To report this problem:"];
  if (artifactPath !== undefined) {
    lines.push(`1. Keep the diagnostic artifact unchanged: ${artifactPath}`);
  } else {
    lines.push("1. Save the complete terminal output because no diagnostic artifact could be written.");
  }
  lines.push(artifactPath === undefined
    ? "2. Share that terminal output and the exact ndrstnd command; for a review, include the selected agent and base."
    : "2. Share that artifact and the exact ndrstnd review command, including the selected agent and base.");
  lines.push("3. If the failure needs agent-output details, rerun with --diagnostic-include-agent-output and share that file only through a private channel.");
  lines.push("4. Do not include credentials, tokens, or repository contents unless they are requested through a secure channel.");
  if (writeError !== undefined) lines.push(`Diagnostic artifact write failed: ${writeError}`);
  return lines.join("\n");
}

function diagnosticAttempt(attempt: AnalysisAttemptTrace, repoPath: string | undefined): DiagnosticAttempt {
  return {
    kind: attempt.kind,
    durationMs: Math.max(0, Math.round(attempt.durationMs)),
    prompt: attempt.prompt,
    response: attempt.response,
    activity: attempt.activity,
    validation: attempt.validation === undefined ? undefined : {
      phase: attempt.validation.phase,
      message: redactText(attempt.validation.message, repoPath),
    },
    error: attempt.error === undefined ? undefined : redactText(attempt.error, repoPath),
  };
}

function diagnosticScope(input: CollectedReviewInput): DiagnosticArtifact["scope"] {
  const hunkCounts = new Map<string, number>();
  for (const hunk of input.hunks) hunkCounts.set(hunk.fileId, (hunkCounts.get(hunk.fileId) ?? 0) + 1);
  const meaningfulFileCount = input.files.filter((file) => file.signal === "meaningful").length;
  return {
    repoPath: "<repo>",
    targetRef: redactText(input.targetRef, input.repoPath),
    baseRef: redactText(input.baseRef, input.repoPath),
    mergeBase: redactText(input.mergeBase, input.repoPath),
    includesWorkingTree: input.includesWorkingTree === true,
    inputHash: sha256(JSON.stringify(input)),
    fileCount: input.files.length,
    meaningfulFileCount,
    hunkCount: input.hunks.length,
    files: input.files.map((file) => ({
      path: redactText(file.path, input.repoPath),
      status: file.status,
      binary: file.binary,
      signal: file.signal,
      signalReason: file.signalReason === undefined ? undefined : redactText(file.signalReason, input.repoPath),
      hunkCount: hunkCounts.get(file.id) ?? 0,
    })),
  };
}

function redactCommandArgs(args: readonly string[], repoPath: string | undefined): string[] {
  const redacted: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--repo" || argument === "--conversation") {
      redacted.push(argument, argument === "--repo" ? "<repo>" : "<conversation>");
      index += 1;
      continue;
    }
    redacted.push(redactText(argument, repoPath));
  }
  return redacted;
}

function redactText(value: string, repoPath: string | undefined): string {
  let redacted = value;
  if (repoPath !== undefined && repoPath !== "") redacted = redacted.split(repoPath).join("<repo>");
  const home = homedir();
  if (home !== "") redacted = redacted.split(home).join("<home>");
  return redacted.slice(0, 8_000);
}

function diagnosticNextSteps(): string[] {
  return [
    "Keep this JSON artifact unchanged when sharing it with the ndrstnd maintainer.",
    "Include the exact review command, selected agent, and intended base/target scope.",
    "Use --diagnostic-include-agent-output only for a private escalation when the maintainer asks for the raw response.",
    "Remove credentials or tokens before sharing; the default artifact intentionally excludes prompts, diffs, environment variables, and raw responses.",
  ];
}

function fileTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-").replace(/Z$/, "");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
