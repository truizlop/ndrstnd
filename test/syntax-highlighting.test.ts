import { describe, expect, it } from "vitest";
import { renderArtifact } from "../src/web/page.js";
import { buildFallbackAnalysis } from "../src/server/analyze.js";
import type { StoredReviewSession } from "../src/server/store.js";

describe("syntax-highlighted diff snapshots", () => {
  it("uses the path-selected Shiki grammar and renders each file header once", async () => {
    const input = {
      repoPath: "/repo", targetRef: "WORKTREE", baseRef: "main", mergeBase: "abcdef123456", files: [
        { id: "typescript", path: "src/example.ts", status: "modified" as const, binary: false, signal: "meaningful" as const },
        { id: "python", path: "scripts/example.py", status: "modified" as const, binary: false, signal: "meaningful" as const },
        { id: "json", path: "config/settings.json", status: "modified" as const, binary: false, signal: "meaningful" as const },
      ],
      hunks: [
        { id: "typescript-hunk", fileId: "typescript", oldStart: 1, newStart: 1, lines: [{ kind: "deletion" as const, content: "const enabled = false;", oldLine: 1 }, { kind: "addition" as const, content: "export const enabled = true;", newLine: 1 }] },
        { id: "python-hunk", fileId: "python", oldStart: 2, newStart: 2, lines: [{ kind: "addition" as const, content: "def render(name: str) -> str:", newLine: 2 }, { kind: "addition" as const, content: "    return f\"Hello, {name}\"", newLine: 3 }] },
        { id: "json-hunk", fileId: "json", oldStart: 1, newStart: 1, lines: [{ kind: "addition" as const, content: '{ "enabled": true }', newLine: 1 }] },
      ],
    };
    const session: StoredReviewSession = { id: "session", repoPath: input.repoPath, targetRef: input.targetRef, baseRef: input.baseRef, mergeBase: input.mergeBase, inputHash: "hash", input, createdAt: "now" };
    const revision = { id: "revision", sessionId: session.id, source: "fallback" as const, status: "partial" as const, document: buildFallbackAnalysis(input), createdAt: "now" };

    const page = await renderArtifact(session, revision);
    const fullDiff = page.match(/<section id="diff"[\s\S]*?<\/section>/)?.[0];

    expect(fullDiff).toBeDefined();
    expect(fullDiff?.match(/▱ src\/example\.ts/g)).toHaveLength(1);
    expect(fullDiff?.match(/▱ scripts\/example\.py/g)).toHaveLength(1);
    expect(fullDiff?.match(/▱ config\/settings\.json/g)).toHaveLength(1);
    expect(fullDiff).toMatchSnapshot();
  });
});
