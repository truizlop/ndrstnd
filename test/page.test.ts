import { describe, expect, it } from "vitest";
import { renderArtifact, renderWorkspace, styles } from "../src/web/page.js";
import { createReviewPresentationData } from "../src/server/review-presentation.js";
import { buildTestAnalysis } from "./fixtures/analysis-fixture.js";
import type { StoredReviewSession } from "../src/server/store.js";
import { frozenReviewData } from "../src/web/frozen-review-data.js";

describe("renderWorkspace", () => {
  it("renders the three review modes and evidence-backed data", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: { repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", files: [{ id: "file", path: "app.ts", status: "modified", binary: false, signal: "meaningful" }], hunks: [{ id: "hunk", fileId: "file", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "trailer = true;", newLine: 1 }] }] },
    };
    const page = await renderWorkspace(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "codex", status: "complete", document: buildTestAnalysis(session.input), createdAt: "now" }), "token");
    expect(page).toContain("Story");
    expect(page).toContain("Timeline");
    expect(page).toContain("Full diff");
    expect(page).toContain("trailer ");
  });

  it("has a touch-first mobile layout without page-level horizontal overflow", () => {
    expect(styles).toContain("@media(max-width:760px)");
    expect(styles).toContain("grid-auto-flow:column;grid-auto-columns:1fr");
    expect(styles).toContain("min-height:44px");
    expect(styles).toContain("overflow-x:auto");
    expect(styles).toContain("-webkit-overflow-scrolling:touch");
    expect(styles).toContain("env(safe-area-inset-bottom)");
  });

  it("renders independently collapsible navigation and review-detail panels", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: { repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", files: [], hunks: [] },
    };
    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "codex", status: "complete", document: buildTestAnalysis(session.input), createdAt: "now" }));
    expect(page).toContain('class="collapse-sidebar panel-toggle"');
    expect(page).toContain('class="collapse-inspector panel-toggle"');
    expect(page).toContain('class="mobile-inspector-toggle panel-toggle"');
    expect(page).toContain("grid-template-columns:64px minmax(0,1fr) 64px");
    expect(page).toContain("mobile-inspector-open");
    expect(page).not.toContain("Offline snapshot");
  });

  it("keeps the galley visual language: three type voices, hairlines, one accent, no gradients", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: { repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", files: [], hunks: [] },
    };
    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "codex", status: "complete", document: buildTestAnalysis(session.input), createdAt: "now" }));
    expect(page).not.toContain("linear-gradient");
    expect(page).not.toContain("--serif");
    expect(page).toContain("--mono:ui-monospace");
    expect(page).toContain('class="mark-deep"');
    expect(page).toContain(".view-bar{position:sticky;top:0");
    expect(page).toContain("--accent:#2757cf");
    expect(page).toContain('<p class="masthead-overline">Change review</p>');
    expect(page).toContain("<h1>agent-change</h1>");
    expect(page).toContain(".page-header h1{margin:0 0 9px;font:600 22px/1.3 var(--mono)");
    expect(page).toContain("against <strong>main</strong>");
    expect(page).toContain("<code>abcdef12</code>");
    expect(page).not.toContain("merge-base abcdef12");
    expect(page).toContain('.nav-item.active::before{content:"";position:absolute;left:-14px;top:9px;bottom:9px;width:2px;border-radius:2px;background:var(--accent)}');
    expect(page).toContain("box-shadow:inset 0 -2px var(--accent)");
    expect(page).toContain('<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 18 18">');
    expect(page).toContain('class="story-toolbar"><div id="map"');
    expect(page).toContain(".chapter-number.attention-low{color:var(--low)}");
    expect(page).toContain(".chapter-number.attention-low::after{background:var(--low)}");
    expect(page).not.toContain(".chapter.open .chapter-number{color:var(--accent)}");
    expect(page).toContain(".chapter-map-meta,.chapter-churn-bar{display:none}");
    expect(page).toContain(".story-level-0 .chapter-map-meta{display:flex");
    expect(page).toContain(".story-level-0 .chapter-churn-bar .additions{width:calc(var(--add) * 1%)");
    expect(page).toContain(".story-level-0 .chapter-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(page).toContain("pointer-events:none");
    expect(page).toContain(".story-level-1 .chevron{display:none}");
    expect(page).toContain(".story-zoom-controls[hidden]{display:none!important}");
    expect(page).toContain(".story-level-4 .focused-code,.story-level-4 .focused-label,.story-level-4 .evidence-context{display:none}");
    expect(page).toContain(".story-level-4 .raw-code{display:block}");
    expect(page).toContain('data-action="export"');
    expect(page).toContain('data-action="copy-summary"');
    expect(page).not.toContain('data-action="print"');
    for (const glyph of ["⇧", "✧", "☷", "▱", "🔐", "⚡", "🔧", "🧹", "🔁"]) expect(page).not.toContain(glyph);
    expect(page).toContain("created by Tomás Ruiz-López");
    expect(page.match(/\.story-zoom-controls\{[\s\S]*?\.zoom\.is-changing \.zoom-callout\{[^}]*\}/)?.[0]).toMatchSnapshot();
    expect(page.match(/\.story-level-0 \.chapter-list\{[^}]*\}/)?.[0]).toMatchSnapshot();
  });

  it("renders the zoom rail and callout to the approved shape", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: { repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", files: [], hunks: [] },
    };
    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "codex", status: "complete", document: buildTestAnalysis(session.input), createdAt: "now" }));
    expect(page.match(/<div class="view-bar">[\s\S]*?aria-label="Increase detail">\+<\/button><\/div><\/div>/)?.[0]).toMatchSnapshot();
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
    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "codex", status: "complete", document: buildTestAnalysis(session.input), createdAt: "now" }));
    const focusedExcerpt = page.match(/<article class="evidence focused-evidence"[\s\S]*?<\/article>/)?.[0] ?? "";
    expect(focusedExcerpt).toContain("Focused excerpt");
    expect(focusedExcerpt).toContain("Complete excerpt");
    expect(focusedExcerpt).toContain("execute");
    expect(focusedExcerpt).toContain("(job);");
    expect(focusedExcerpt).toContain('class="line omission"');
    expect(focusedExcerpt.match(/<pre class="focused-code">[\s\S]*?<\/pre>/)?.[0]).not.toContain("private ready = false;");
    expect(focusedExcerpt.match(/<pre class="focused-code">[\s\S]*?<\/pre>/)?.[0]).not.toContain("get status() { return this.ready; }");
    // The raw variant ships once in the Full diff and is cloned at runtime.
    expect(focusedExcerpt).not.toContain('<pre class="raw-code">');
    const rawSource = page.match(/<div class="diff-block" data-diff-hunk="source-hunk">[\s\S]*?<\/pre>/)?.[0] ?? "";
    expect(rawSource).toContain(">ready<");
    expect(rawSource).toContain(">status<");
    expect(focusedExcerpt.match(/<article class="evidence focused-evidence"[\s\S]*?<\/article>/)?.[0]).toMatchSnapshot();
    expect(page).toContain("Other files changed");
    expect(page).toContain(".gitignore");
    expect(page).toContain("+1");
  });

  it("shows Map cards with per-chapter churn, file, and hunk context", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: {
        repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456",
        files: [
          { id: "runner", path: "src/runner.ts", status: "modified", binary: false, signal: "meaningful" },
          { id: "test", path: "test/runner.test.ts", status: "modified", binary: false, signal: "meaningful" },
        ],
        hunks: [
          {
            id: "runner-hunk", fileId: "runner", oldStart: 8, newStart: 8,
            lines: [
              { kind: "deletion", content: "runLegacyJob(job);", oldLine: 8 },
              { kind: "addition", content: "runQueuedJob(job);", newLine: 8 },
              { kind: "addition", content: "recordRun(job.id);", newLine: 9 },
            ],
          },
          {
            id: "test-hunk", fileId: "test", oldStart: 3, newStart: 3,
            lines: [{ kind: "addition", content: "test(\"runs queued jobs\", () => {});", newLine: 3 }],
          },
        ],
      },
    };
    const document = {
      summary: "Runner work is grouped into one story card.",
      chapters: [{
        id: "runner-story",
        title: "Runner queue behavior",
        kind: "behavior" as const,
        synopsis: "Queued jobs now record run state.",
        confidence: "high" as const,
        attention: "contained" as const,
        riskCategories: ["behavior" as const],
        evidenceIds: ["runner-hunk", "test-hunk"],
      }],
      steps: [
        {
          id: "step-01",
          title: "Queue jobs",
          goal: "Introduce queued job execution.",
          youNowHave: "Jobs can be queued and recorded.",
          deferred: [{ concern: "Test coverage follows after the behavior exists.", resolvedByStepId: "step-02" }],
          dependsOn: [],
          forwardRefs: {},
          advancesChapterIds: ["runner-story"],
          evidenceIds: ["runner-hunk"],
        },
        {
          id: "step-02",
          title: "Cover queueing",
          goal: "Exercise queued job execution.",
          youNowHave: "The queue behavior has test evidence.",
          deferred: [],
          dependsOn: ["step-01"],
          forwardRefs: {},
          advancesChapterIds: ["runner-story"],
          evidenceIds: ["test-hunk"],
        },
      ],
      omittedGroups: [],
      unclassifiedEvidenceIds: [],
    };
    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "codex", status: "complete", document, createdAt: "now" }));
    const card = page.match(/<article class="chapter" data-chapter="runner-story"><button class="chapter-toggle"[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(card).toContain('class="chapter-map-meta" aria-label="3 additions, 1 deletion, 2 files, 2 hunks"');
    expect(card).toContain('<b class="additions">+3</b><b class="deletions">−1</b>');
    expect(card).toContain("<span>2 files</span><span>2 hunks</span>");
    expect(card).toContain('class="chapter-churn-bar" aria-hidden="true" style="--add:75;--delete:25"');
    expect(card).toMatchSnapshot();
    expect(card).toContain('data-story-step="step-01"');
    expect(card).toContain('data-story-step="step-02"');
    expect(page).toContain('data-timeline-state="step-01"');
    expect(page).toContain('data-timeline-state="step-02"');
    expect(page).toContain("A constructive reconstruction of how you would assemble this change");
    expect(page).toContain("Queue jobs");
    expect(page).toContain("Cover queueing");
    expect(page).toContain("src/runner.ts");
    expect(page).toContain("test/runner.test.ts");
    expect(page).toContain('<b class="additions">+2</b>');
  });

  it("ships each timeline hunk once as a template and references it per step", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: {
        repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456",
        files: [{ id: "source", path: "src/runner.ts", status: "modified", binary: false, signal: "meaningful" }],
        hunks: [
          { id: "hunk-1", fileId: "source", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "export function first() { return true; }", newLine: 1 }] },
          { id: "hunk-2", fileId: "source", oldStart: 5, newStart: 5, lines: [{ kind: "addition", content: "export function second() { return first(); }", newLine: 5 }] },
          { id: "hunk-3", fileId: "source", oldStart: 9, newStart: 9, lines: [{ kind: "addition", content: "export function third() { return second(); }", newLine: 9 }] },
        ],
      },
    };
    const document = {
      summary: "Three increments build the runner.",
      chapters: [{ id: "runner", title: "Runner", kind: "behavior" as const, synopsis: "Runner behavior changes.", confidence: "high" as const, attention: "contained" as const, riskCategories: ["behavior" as const], evidenceIds: ["hunk-1", "hunk-2", "hunk-3"] }],
      steps: [1, 2, 3].map((number) => ({
        id: `step-0${number}`,
        title: `Build part ${number}`,
        goal: `Introduce part ${number}.`,
        youNowHave: `Part ${number} exists.`,
        deferred: [],
        dependsOn: number === 1 ? [] : [`step-0${number - 1}`],
        forwardRefs: {},
        advancesChapterIds: ["runner"],
        evidenceIds: [`hunk-${number}`],
      })),
      omittedGroups: [],
      unclassifiedEvidenceIds: [],
    };

    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "codex", status: "complete", document, createdAt: "now" }));
    const state = (stepId: string) => {
      const start = page.indexOf(`data-timeline-state="${stepId}"`);
      if (start < 0) return "";
      const articleStart = page.lastIndexOf("<article", start);
      const next = page.indexOf('<article class="timeline-state', start + stepId.length);
      return page.slice(articleStart, next < 0 ? page.indexOf("</div></div></section>", start) : next);
    };

    expect(state("step-01")).toContain('data-current-evidence="hunk-1"');
    expect(state("step-01")).toContain('data-prior-evidence=""');
    expect(state("step-02")).toContain('data-current-evidence="hunk-2"');
    expect(state("step-02")).toContain('data-prior-evidence="hunk-1"');
    expect(state("step-03")).toContain('data-prior-evidence="hunk-1 hunk-2"');
    for (const id of ["hunk-1", "hunk-2", "hunk-3"]) {
      expect(page.match(new RegExp(`data-evidence-template="${id}"`, "g"))).toHaveLength(1);
      expect(state("step-03")).not.toContain(`data-evidence-id="${id}"`);
    }
    expect(page.match(/data-evidence-id="hunk-1"/g)).toHaveLength(1);
    expect(page.match(/data-diff-hunk="hunk-1"/g)).toHaveLength(1);
    expect(page).toContain('data-evidence-list="hunk-1 hunk-2 hunk-3"');
  });

  it("renders Test plan zoom projections from one test information model", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: {
        repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456",
        files: [
          { id: "source", path: "src/git.ts", status: "modified", binary: false, signal: "meaningful" },
          { id: "test", path: "test/git.test.ts", status: "modified", binary: false, signal: "meaningful" },
        ],
        hunks: [
          { id: "source-hunk", fileId: "source", oldStart: 10, newStart: 10, lines: [{ kind: "addition", content: "collectWorktreeChanges();", newLine: 10 }] },
          {
            id: "test-hunk", fileId: "test", oldStart: 3, newStart: 3,
            lines: [
              { kind: "context", content: "describe(\"worktree review\", () => {", oldLine: 3, newLine: 3 },
              { kind: "addition", content: "  test(\"includes staged and unstaged changes\", () => {", newLine: 4 },
              { kind: "addition", content: "    expect(input.files).toContain(\"draft.ts\");", newLine: 5 },
              { kind: "addition", content: "  });", newLine: 6 },
            ],
          },
        ],
      },
    };
    const document = {
      summary: "Worktree-aware review input.",
      chapters: [
        {
          id: "worktree-theme",
          title: "Worktree handling",
          kind: "behavior" as const,
          synopsis: "Review input now includes local worktree changes.",
          before: "Review input focused on committed branch differences.",
          after: "Review input includes local worktree changes.",
          confidence: "high" as const,
          attention: "contained" as const,
          riskCategories: ["behavior" as const],
          evidenceIds: ["source-hunk"],
        },
        {
          id: "worktree-tests",
          title: "Exercise worktree handling",
          kind: "test" as const,
          synopsis: "Tests show staged and unstaged changes are included in review input.",
          confidence: "high" as const,
          attention: "low" as const,
          riskCategories: ["behavior" as const],
          evidenceIds: ["test-hunk"],
        },
      ],
      steps: [
        {
          id: "step-01",
          title: "Collect worktree",
          goal: "Introduce worktree-aware input collection.",
          youNowHave: "Review input includes local worktree changes.",
          deferred: [{ concern: "Tests are introduced after the implementation path.", resolvedByStepId: "step-02" }],
          dependsOn: [],
          forwardRefs: {},
          advancesChapterIds: ["worktree-theme"],
          evidenceIds: ["source-hunk"],
        },
        {
          id: "step-02",
          title: "Exercise worktree",
          goal: "Verify staged and unstaged changes.",
          youNowHave: "Worktree-aware input has test evidence.",
          deferred: [],
          dependsOn: ["step-01"],
          forwardRefs: {},
          advancesChapterIds: ["worktree-tests"],
          evidenceIds: ["test-hunk"],
        },
      ],
      omittedGroups: [],
      unclassifiedEvidenceIds: [],
    };
    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "codex", status: "complete", document, createdAt: "now" }));
    expect(page.indexOf("Test plan</button>")).toBeGreaterThan(-1);
    expect(page.indexOf("Test plan</button>")).toBeLessThan(page.indexOf("Full diff</button>"));
    expect(page).toContain("See how the changed behavior was exercised, from high-level themes to raw test evidence.");
    expect(page).toContain("1 tested behavior");
    expect(page).toContain("1 test file");
    expect(page).toContain("Run result not observed");
    expect(page).toContain('class="test-plan-level test-plan-map"');
    expect(page).toContain("Worktree handling");
    expect(page).toContain("Unit");
    expect(page).toContain('class="test-plan-level test-plan-summary-level"');
    expect(page).toContain("includes staged and unstaged changes");
    expect(page).toContain("Test implementation found");
    expect(page).toContain('class="test-plan-level test-plan-explanation"');
    expect(page).toContain('class="test-what"');
    expect(page).toContain('class="test-ref-file"');
    expect(page).not.toContain('class="test-ref-claim"');
    expect(page).toContain('class="test-plan-level test-plan-evidence"');
    expect(page).toContain("Execution evidence not observed");
    expect(page).toContain('class="test-plan-level test-plan-raw"');
    expect(page).toContain("Changed test files");
    expect(page).toContain("Complete output");
    expect(page).not.toContain("Coverage gap");
    expect(page).not.toContain("Suggested test");
  });

  it("renders a neutral Test plan empty state", async () => {
    const session: StoredReviewSession = {
      id: "session", repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", inputHash: "hash", createdAt: "now",
      input: { repoPath: "/repo", targetRef: "agent-change", baseRef: "main", mergeBase: "abcdef123456", files: [], hunks: [] },
    };
    const page = await renderArtifact(createReviewPresentationData(session, { id: "revision", sessionId: "session", source: "codex", status: "complete", document: buildTestAnalysis(session.input), createdAt: "now" }));
    expect(page).not.toContain("Test plan</button>");
    expect(page).toContain("No test activity was captured for this change.");
    expect(page).not.toContain("No dedicated test change was identified.");
    expect(page).not.toContain("Missing test");
  });
});

it("renders the frozen presentation fixture without Git, analysis, or the review store", async () => {
  const page = await renderArtifact(frozenReviewData);
  expect(page).toContain("frozen-ui-change");
  expect(page).toContain("Run the supplied job");
  expect(page).toContain("Cover job execution");
  expect(page).toContain('class="chapter-number attention-low"');
  expect(page).toContain("Retry transient failures");
  expect(page).toContain("Surface retry telemetry");
  expect(page).toContain("Count retries in telemetry");
  expect(page).toContain('<code>RetryPolicy</code> is introduced at <button data-timeline-select="step-02">step 02</button>');
  expect(page).toContain("Transient failures still bubble up immediately; retry semantics arrive with the policy.");
  expect(page).toContain('<button data-timeline-select="step-01">Builds on · step 01</button>');
  expect(page).toContain("Release bookkeeping");
  expect(page).toContain("2 low-signal hunks collapsed");
  expect(page).toContain("Test plan</button>");
  expect(page).toContain("1 observed test run");
  expect(page).toContain("Observed result: passed");
  expect(page).toContain("npm test");
  expect(page).toContain("observed in the conversation");
  expect(page).toContain("Suite passed");
});

it("drives the Evidence-zoom focused excerpt from analysis focus ranges with a heuristic fallback", async () => {
  const page = await renderArtifact(frozenReviewData);
  const evidence = /<article class="evidence focused-evidence" data-evidence-id="retry-hunk">([\s\S]*?)<\/article>/.exec(page)![1];
  const focusedBlock = /<pre class="focused-code">([\s\S]*?)<\/pre>/.exec(evidence)![1];
  expect(focusedBlock).toContain("maxAttempts");
  expect(focusedBlock).not.toContain("RetryPolicy");
  expect(evidence).not.toContain('<pre class="raw-code">');
  expect(/<div class="diff-block" data-diff-hunk="retry-hunk">([\s\S]*?)<\/pre>/.exec(page)![1]).toContain("RetryPolicy");

  const withoutFocus = await renderArtifact({ ...frozenReviewData, document: { ...frozenReviewData.document, focus: undefined } });
  const fallbackEvidence = /<article class="evidence focused-evidence" data-evidence-id="retry-hunk">([\s\S]*?)<\/article>/.exec(withoutFocus)![1];
  expect(/<pre class="focused-code">([\s\S]*?)<\/pre>/.exec(fallbackEvidence)![1]).toContain("RetryPolicy");
});

it("collapses unclassified evidence alongside omitted groups", async () => {
  const data = { ...frozenReviewData, document: { ...frozenReviewData.document, unclassifiedEvidenceIds: ["lockfile-hunk"] } };
  const page = await renderArtifact(data);
  expect(page).toContain("3 low-signal or unclassified hunks collapsed");
  expect(page).toContain("Unclassified evidence");
});
