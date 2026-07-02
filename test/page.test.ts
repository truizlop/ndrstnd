import { describe, expect, it } from "vitest";
import { renderArtifact, renderWorkspace, styles } from "../src/web/page.js";
import { createReviewPresentationData } from "../src/server/review-presentation.js";
import { buildFallbackAnalysis } from "../src/server/analyze.js";
import type { StoredReviewSession } from "../src/server/store.js";
import { frozenReviewData } from "../src/web/frozen-review-data.js";

describe("renderWorkspace", () => {
  it("renders the three review modes and evidence-backed data", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: { repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", files: [{ id: "file", path: "app.ts", status: "modified", binary: false, signal: "meaningful" }], hunks: [{ id: "hunk", fileId: "file", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "trailer = true;", newLine: 1 }] }] },
    };
    const page = await renderWorkspace(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "fallback", status: "partial", document: buildFallbackAnalysis(session.input), createdAt: "now" }), "token");
    expect(page).toContain("Story");
    expect(page).toContain("Timeline");
    expect(page).toContain("Full diff");
    expect(page).toContain("trailer ");
  });

  it("has a touch-first mobile layout without page-level horizontal overflow", () => {
    expect(styles).toContain("@media(max-width:760px)");
    expect(styles).toContain("grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(styles).toContain("min-height:44px");
    expect(styles).toContain("overflow-x:auto");
    expect(styles).toContain("-webkit-overflow-scrolling:touch");
  });

  it("renders independently collapsible navigation and review-detail panels", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: { repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", files: [], hunks: [] },
    };
    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "fallback", status: "partial", document: buildFallbackAnalysis(session.input), createdAt: "now" }));
    expect(page).toContain('class="collapse-sidebar panel-toggle"');
    expect(page).toContain('class="collapse-inspector panel-toggle"');
    expect(page).toContain('class="mobile-inspector-toggle panel-toggle"');
    expect(page).toContain("grid-template-columns:54px minmax(0,1fr) 54px");
    expect(page).toContain("mobile-inspector-open");
    expect(page).not.toContain("Offline snapshot");
  });

  it("uses the concept's rail controls and segmented mobile tab treatment", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: { repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", files: [], hunks: [] },
    };
    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "fallback", status: "partial", document: buildFallbackAnalysis(session.input), createdAt: "now" }));
    expect(page).toContain("width:38px;height:38px;border:1px solid #dfe4e8");
    expect(page).toContain("font-size:20px;line-height:1");
    expect(page).toContain("background:linear-gradient(90deg,#e6f2ff 0%,#f1f8ff 48%,#f6f7f8 100%)");
    expect(page).toContain(".nav-item.active::before{content:\"\";position:absolute;top:0;bottom:0;left:-13px;width:3px;background:#167ee7}");
    expect(page).toContain("box-shadow:inset 0 -3px #167ee7");
    expect(page).toContain(".sidebar nav .nav-item:nth-child(4):last-child{grid-column:1/-1");
    expect(page).toContain(".collapse-sidebar{position:absolute;top:10px;left:calc(100% - 50px)");
    expect(page).toContain(".sidebar.collapsed .collapse-sidebar{top:52px;left:2px;transform:rotate(180deg)}");
    expect(page).toContain("body:not(.story-level-0) .chapter-copy small{display:block;white-space:normal;overflow:visible;text-overflow:clip;-webkit-line-clamp:unset}");
    expect(page).toContain('class="story-toolbar"><div id="map"');
    expect(page).toContain(".story-toolbar #collapse-all{flex:0 0 auto");
    expect(page).toContain("Target <strong>agent-change</strong>");
    expect(page).toContain("Base <strong>main</strong>");
    expect(page).toContain("<code>abcdef12</code>");
    expect(page).not.toContain("merge-base abcdef12");
    expect(page).not.toContain("Local review session saved");
    expect(page).not.toContain("Mark all reviewed");
    expect(page).toContain('data-action="export"');
    expect(page).not.toContain('data-action="print"');
    expect(page).not.toContain("Print review");
    expect(page).toContain('data-action="copy-summary"');
    expect(page).not.toContain("⌘ repo");
    expect(page).toContain('.sidebar.collapsed .nav-item{display:grid;place-items:center;width:42px;height:42px;min-height:42px;padding:0;line-height:1}');
    expect(page).toContain('<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 18 18">');
    expect(page).toContain('.sidebar.collapsed .nav-item .nav-icon{display:grid;place-items:center;width:20px;height:20px;line-height:1;text-align:center;transform:none}');
    expect(page).toContain('.sidebar.collapsed .nav-item .nav-icon svg{width:16px;height:16px}');
    expect(page).toContain(".story-level-0 .chapter-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(page).toContain(".story-level-0 .chapter-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;max-height:none;overflow:visible;border:0;border-radius:0;opacity:1;transform:none;pointer-events:none}");
    expect(page).toContain(".story-level-1 .chevron{display:none}");
    expect(page).toContain(".story-zoom-controls[hidden]{display:none!important}");
    expect(page).toContain(".story-level-4 .focused-code,.story-level-4 .focused-label,.story-level-4 .evidence-context{display:none}");
    expect(page).toContain(".story-level-4 .raw-code{display:block}");
    expect(page).not.toContain("chapter-impact");
    expect(page.match(/\.sidebar\.collapsed nav\{[^`]+?text-align:center;transform:none\}/)?.[0]).toMatchSnapshot();
    expect(page.match(/\.story-level-0 \.chapter-list\{[^`]+?@media\(prefers-reduced-motion:reduce\)\{\.story-level-0 \.chapter\{animation:none;transition:none\}\}/)?.[0]).toMatchSnapshot();
  });

  it("renders the zoom rail and callout to the approved shape", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: { repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", files: [], hunks: [] },
    };
    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "fallback", status: "partial", document: buildFallbackAnalysis(session.input), createdAt: "now" }));
    expect(page.match(/<div class="story-zoom-controls">[\s\S]*?<\/div><\/div><\/header>/)?.[0]).toMatchSnapshot();
    expect(page).not.toContain('class="zoom-info"');
    expect(page).not.toContain('<dialog id="zoom-dialog"');
  });

  it("distills Evidence to important code and groups supporting files into a compact summary", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: {
        repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456",
        files: [
          { id: "source", path: "src/runner.ts", status: "modified", binary: false, signal: "meaningful" },
          { id: "ignore", path: ".gitignore", status: "modified", binary: false, signal: "meaningful" },
        ],
        hunks: [
          {
            id: "source-hunk", fileId: "source", oldStart: 1, newStart: 1,
            lines: [
              { kind: "context", content: "export class Runner {", oldLine: 1, newLine: 1 },
              { kind: "addition", content: "  private ready = false;", newLine: 2 },
              { kind: "context", content: "", oldLine: 2, newLine: 3 },
              { kind: "addition", content: "  async run(job: Job) {", newLine: 4 },
              { kind: "addition", content: "    await this.execute(job);", newLine: 5 },
              { kind: "addition", content: "  }", newLine: 6 },
              { kind: "context", content: "", oldLine: 3, newLine: 7 },
              { kind: "addition", content: "  get status() { return this.ready; }", newLine: 8 },
              { kind: "addition", content: "  return job.id;", newLine: 9 },
            ],
          },
          { id: "ignore-hunk", fileId: "ignore", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: ".ndrstnd/", newLine: 1 }] },
        ],
      },
    };
    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "fallback", status: "partial", document: buildFallbackAnalysis(session.input), createdAt: "now" }));
    const focusedExcerpt = page.match(/<article class="evidence focused-evidence">[\s\S]*?<\/article>/)?.[0] ?? "";
    expect(focusedExcerpt).toContain("Focused excerpt");
    expect(focusedExcerpt).toContain("Complete excerpt");
    expect(focusedExcerpt).toContain("execute");
    expect(focusedExcerpt).toContain("(job);");
    expect(focusedExcerpt).toContain('class="line omission"');
    expect(focusedExcerpt.match(/<pre class="focused-code">[\s\S]*?<\/pre>/)?.[0]).not.toContain("private ready = false;");
    expect(focusedExcerpt.match(/<pre class="focused-code">[\s\S]*?<\/pre>/)?.[0]).not.toContain("get status() { return this.ready; }");
    expect(focusedExcerpt.match(/<pre class="raw-code">[\s\S]*?<\/pre>/)?.[0]).toContain("private ready");
    expect(focusedExcerpt.match(/<pre class="raw-code">[\s\S]*?<\/pre>/)?.[0]).toContain("false");
    expect(focusedExcerpt.match(/<pre class="raw-code">[\s\S]*?<\/pre>/)?.[0]).toContain("status");
    expect(focusedExcerpt.match(/<pre class="raw-code">[\s\S]*?<\/pre>/)?.[0]).toContain("this");
    expect(focusedExcerpt.match(/<pre class="raw-code">[\s\S]*?<\/pre>/)?.[0]).toContain(".ready");
    expect(focusedExcerpt.match(/<article class="evidence focused-evidence">[\s\S]*?<\/article>/)?.[0]).toMatchSnapshot();
    expect(page).toContain("Other files changed");
    expect(page).toContain(".gitignore");
    expect(page).toContain("+1");
  });
});

it("renders the frozen presentation fixture without Git, analysis, or the review store", async () => {
  const page = await renderArtifact(frozenReviewData);
  expect(page).toContain("frozen-ui-change");
  expect(page).toContain("Run the supplied job");
  expect(page).toContain("Cover job execution");
});
