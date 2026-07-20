import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDiagnosticInstructions, responseMetadata, textMetadata, writeDiagnosticArtifact } from "../src/server/diagnostic.js";
import { DiagnosticArtifactSchema } from "../src/shared/diagnostic-schema.js";
import type { ReviewAgent } from "../src/server/agent.js";
import type { CollectedReviewInput } from "../src/server/git.js";

const input: CollectedReviewInput = {
  repoPath: "/Users/example/project",
  targetRef: "feature/diagnostics",
  baseRef: "main",
  mergeBase: "0123456789abcdef0123456789abcdef01234567",
  includesWorkingTree: true,
  files: [{ id: "source", path: "src/feature.ts", status: "modified", binary: false, signal: "meaningful" }],
  hunks: [{ id: "source-hunk", fileId: "source", oldStart: 1, newStart: 1, lines: [] }],
};

const agent = {
  id: "codex",
  name: "Codex",
  command: "codex",
} as ReviewAgent;

describe("diagnostic artifacts", () => {
  it("writes a validated, redacted artifact by default", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ndrstnd-diagnostic-"));
    const artifactPath = await writeDiagnosticArtifact({
      directory,
      toolVersion: "test-version",
      commandArgs: ["review", "feature/diagnostics", "--repo", input.repoPath, "--conversation", "/Users/example/private.md"],
      agent,
      input,
      failure: {
        phase: "analysis",
        message: "JSON parsing failed",
        attempts: [{
          kind: "initial",
          durationMs: 123,
          prompt: textMetadata("private prompt"),
          response: responseMetadata("{\"summary\":\"secret source code\"}", "{\"summary\":\"secret source code\"}"),
          activity: { label: "Received response", notifications: 2, draftCharacters: 34 },
          validation: { phase: "json-parsing", message: "JSON parsing failed" },
          rawResponse: "secret source code",
        }],
      },
      now: new Date("2026-07-20T10:11:12.000Z"),
    });

    const artifact = DiagnosticArtifactSchema.parse(JSON.parse(await readFile(artifactPath, "utf8")));
    expect(artifact.kind).toBe("ndrstnd-analysis-diagnostic");
    expect(artifact.scope?.repoPath).toBe("<repo>");
    expect(artifact.command.args).toContain("<repo>");
    expect(artifact.command.args).toContain("<conversation>");
    expect(artifact.attempts[0]?.prompt.length).toBe("private prompt".length);
    expect(artifact.attempts[0]?.prompt).not.toHaveProperty("value");
    expect(artifact.rawAgentResponses).toBeUndefined();
    expect(artifact.sensitiveDataIncluded).toBe(false);
    expect(JSON.stringify(artifact)).not.toContain("secret source code");
  });

  it("includes raw responses only when explicitly requested", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ndrstnd-diagnostic-"));
    const artifactPath = await writeDiagnosticArtifact({
      directory,
      toolVersion: "test-version",
      commandArgs: ["review", "--diagnostic-include-agent-output"],
      agent,
      input,
      failure: { phase: "analysis", message: "analysis failed", attempts: [{ kind: "initial", durationMs: 1, prompt: textMetadata("prompt"), rawResponse: "private response" }] },
      includeAgentOutput: true,
    });

    const artifact = DiagnosticArtifactSchema.parse(JSON.parse(await readFile(artifactPath, "utf8")));
    expect(artifact.sensitiveDataIncluded).toBe(true);
    expect(artifact.rawAgentResponses?.[0]?.response).toBe("private response");
  });
});

describe("diagnostic reporting instructions", () => {
  it("prints numbered next steps for both artifact and no-artifact failures", () => {
    const withArtifact = formatDiagnosticInstructions("/repo/.ndrstnd/ndrstnd-diagnostic.json");
    expect(withArtifact).toContain("1. Keep the diagnostic artifact unchanged");
    expect(withArtifact).toContain("--diagnostic-include-agent-output");

    const withoutArtifact = formatDiagnosticInstructions(undefined, "permission denied");
    expect(withoutArtifact).toContain("no diagnostic artifact could be written");
    expect(withoutArtifact).toContain("Diagnostic artifact write failed: permission denied");
  });
});
