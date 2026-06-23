import { describe, expect, it } from "vitest";
import { renderArtifact, renderWorkspace, styles } from "../src/web/page.js";
import { buildFallbackAnalysis } from "../src/server/analyze.js";
import type { StoredReviewSession } from "../src/server/store.js";

describe("renderWorkspace", () => {
  it("renders the three review modes and evidence-backed data", () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: { repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", files: [{ id: "file", path: "app.ts", status: "modified", binary: false, signal: "meaningful" }], hunks: [{ id: "hunk", fileId: "file", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "trailer = true;", newLine: 1 }] }] },
    };
    const page = renderWorkspace(session, { id: "revision", sessionId: "session", source: "fallback", status: "partial", document: buildFallbackAnalysis(session.input), createdAt: "now" }, "token");
    expect(page).toContain("Story");
    expect(page).toContain("Timeline");
    expect(page).toContain("Full diff");
    expect(page).toContain("trailer = true;");
  });

  it("has a touch-first mobile layout without page-level horizontal overflow", () => {
    expect(styles).toContain("@media(max-width:760px)");
    expect(styles).toContain("grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(styles).toContain("min-height:44px");
    expect(styles).toContain("overflow-x:auto");
    expect(styles).toContain("-webkit-overflow-scrolling:touch");
  });

  it("renders the zoom rail and callout to the approved shape", () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: { repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", files: [], hunks: [] },
    };
    const page = renderArtifact(session, { id: "revision", sessionId: "session", source: "fallback", status: "partial", document: buildFallbackAnalysis(session.input), createdAt: "now" });
    expect(page.match(/<div class="story-zoom-controls">[\s\S]*?<\/div><\/div><\/header>/)?.[0]).toMatchSnapshot();
    expect(page).not.toContain('class="zoom-info"');
    expect(page).not.toContain('<dialog id="zoom-dialog"');
  });
});
