import type { AnalysisDocument } from "../shared/analysis-schema.js";
import type { ChangedFile, DiffHunk, DiffLine } from "../shared/domain.js";
import type { ReviewPresentationData } from "./review-data.js";
import { parse as parseDiff } from "diff2html";
import type { DiffBlock, DiffLine as ParsedDiffLine } from "diff2html/lib/types.js";
import { getSingletonHighlighter, type BundledLanguage, type Highlighter } from "shiki";

const riskIcon: Record<string, string> = {
  formatting: "🧹", refactor: "🔧", behavior: "🔁", performance: "⚡", security: "🔐",
};

export async function renderWorkspace(data: ReviewPresentationData, launchToken: string): Promise<string> {
  return renderPage(data, launchToken, false);
}

export async function renderArtifact(data: ReviewPresentationData): Promise<string> {
  return renderPage(data, "", true);
}

async function renderPage(data: ReviewPresentationData, launchToken: string, artifact: boolean): Promise<string> {
  const state = JSON.stringify({ sessionId: data.sessionId, revisionId: data.revisionId, token: launchToken }).replace(/</g, "\\u003c");
  const counts = attentionCounts(data.document);
  const filePaths = new Map(data.files.map((file) => [file.id, file.path]));
  const highlighter = await syntaxHighlighter(data.files);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ndrstnd · ${escapeHtml(data.targetRef)}</title><style>${styles}${enhancementStyles}${panelStyles}${conceptPolishStyles}${mapStyles}${zoomPolish}${zoomEdgePolish}${zoomRuntimePolish}${testPlanStyles}${focusedEvidenceStyles}</style></head>
<body><div class="app-shell">
  <aside class="sidebar"><div class="brand"><svg class="brand-mark" viewBox="0 0 28 22" aria-hidden="true"><path d="M2 18V6a5 5 0 0 1 10 0v12M12 18V9a5 5 0 0 1 10 0v9"/></svg><span class="brand-name">ndrstnd</span><button class="collapse-sidebar panel-toggle" aria-label="Collapse navigation" aria-expanded="true">‹</button><button class="mobile-inspector-toggle panel-toggle" aria-label="Show review details" aria-expanded="false">☷</button></div><nav aria-label="Review views"><button class="nav-item active" data-view="trailer">${navIcon("story")}Story</button><button class="nav-item" data-view="timeline">${navIcon("timeline")}Timeline</button><button class="nav-item" data-view="diff">${navIcon("diff")}Full diff</button>${data.document.chapters.some((chapter) => chapter.kind === "test") ? `<button class="nav-item" data-view="tests">${navIcon("tests")}Test plan</button>` : ""}</nav></aside>
  <main class="main"><header class="page-header"><div><h1>Review changes</h1><div class="breadcrumbs"><span>Target <strong>${escapeHtml(data.targetRef)}</strong></span><span>Base <strong>${escapeHtml(data.baseRef)}</strong></span><code>${escapeHtml(data.mergeBase.slice(0, 8))}</code></div></div><div class="header-controls">${artifact ? "" : `<label class="lens-label">Lens <select id="lens-select" aria-label="Review lens"><option>Loading…</option></select></label>`}<div class="story-zoom-controls"><button data-zoom-step="-1" aria-label="Decrease detail">−</button><div class="zoom" id="zoom-control" role="group" aria-label="Story detail level"><div class="zoom-callout" id="zoom-callout" aria-live="polite"><output id="zoom-label">Summary</output><span id="zoom-description">Story claims and summaries</span></div><button data-zoom="0" aria-label="Map" title="Map"></button><button data-zoom="1" aria-label="Summary" title="Summary" class="active"></button><button data-zoom="2" aria-label="Explanation" title="Explanation"></button><button data-zoom="3" aria-label="Evidence" title="Evidence"></button><button data-zoom="4" aria-label="Raw" title="Raw"></button></div><button data-zoom-step="1" aria-label="Increase detail">+</button></div></div></header>
  ${artifact ? "" : `<div id="lens-notice" class="notice" hidden><span>Review lens changed. Grouping and risk signals will change.</span><button id="rerun">Re-run analysis</button></div>`}
  <section id="trailer" class="view active"><div class="story-tools"><p class="review-summary">${escapeHtml(data.document.summary)}</p></div><p class="coverage">${data.files.length} files · ${data.hunks.length} evidence hunks · ${data.document.chapters.length} story steps</p><div class="story-toolbar"><div id="map" class="map" hidden>${Object.entries(counts).map(([key, value]) => `<div><span class="dot ${key}"></span>${escapeHtml(key)} <strong>${value}</strong></div>`).join("")}</div><button id="collapse-all">Collapse all</button></div><div class="chapter-list">${renderChapters(data.document, data.hunks, filePaths, data.files, highlighter)}</div>${renderOtherFilesChanged(data.files, data.hunks)}${renderOmitted(data.document, data.hunks)}</section>
  <section id="timeline" class="view"><p class="section-title">Suggested implementation story</p><div class="timeline">${data.document.chapters.map((chapter, index) => `<button data-timeline-chapter="${escapeHtml(chapter.id)}"><span>${index + 1}</span><div><h2>${escapeHtml(chapter.title)}</h2><p>${escapeHtml(chapter.synopsis)}</p></div></button>`).join("")}</div></section>
  <section id="diff" class="view"><p class="section-title">Every patch hunk</p>${data.files.map((file) => renderFullDiff(file, data.hunks.filter((hunk) => hunk.fileId === file.id), highlighter)).join("")}</section>
  <section id="tests" class="view"><p class="section-title">Test plan</p><p class="coverage">Test coverage organized from the added test evidence. Tap a case to inspect its implementation.</p>${renderTestPlan(data.document, data.hunks, filePaths)}</section>
  </main>
  <aside class="inspector" aria-label="Review details"><header class="inspector-header"><h2>Review progress</h2><button class="collapse-inspector panel-toggle" aria-label="Collapse review details" aria-expanded="true">›</button></header><div class="inspector-content"><div class="progress"><div class="ring">${data.document.chapters.length}</div><div><strong>chapters</strong><span>ready to understand</span></div></div><section><h3>Focus areas</h3>${Object.entries(categoryCounts(data.document)).map(([category, count]) => `<div class="stat-row"><span>${riskIcon[category] ?? "•"} ${escapeHtml(category)}</span><strong>${count}</strong></div>`).join("")}</section><section><h3>Files</h3><div class="stat-row"><span>Changed files</span><strong>${data.files.length}</strong></div><div class="stat-row"><span>Evidence hunks</span><strong>${data.hunks.length}</strong></div></section><section><h3>Actions</h3><button class="inspector-action" data-action="export">⇧ Export review…</button><button class="inspector-action" data-action="copy-summary" title="Copy a concise prompt for asking Codex about this review">Copy Codex prompt</button></section></div></aside>
</div><div id="selection-menu" class="selection-menu" hidden><button data-question="Explain the selected lines.">✧ Explain selection</button><button data-question="Trace the callers, effects, and dependencies of the selected lines.">⌘ Trace effects</button><button data-question="Why is this included in the change?">⌁ Why included?</button><button data-action="ask">◌ Ask a question</button></div><div id="toast" class="toast" hidden></div><script>${artifact ? artifactClientScript : `const ndrstnd=${state};${clientScript}`}${portableEnhancements}</script></body></html>`;
}

function renderChapters(document: AnalysisDocument, hunks: DiffHunk[], filePaths: Map<string, string>, files: ChangedFile[], highlighter: Highlighter): string {
  const filesById = new Map(files.map((file) => [file.id, file]));
  return document.chapters.map((chapter, index) => {
    const focusedEvidence = chapter.evidenceIds
      .map((id) => requireHunk(hunks, id))
      .filter((hunk) => !isSupportingFile(filesById.get(hunk.fileId)))
      .map((hunk) => renderEvidence(hunk, filePaths.get(hunk.fileId) ?? hunk.fileId, highlighter))
      .filter(Boolean)
      .join("");
    return `<article class="chapter" data-chapter="${escapeHtml(chapter.id)}"><button class="chapter-toggle" aria-expanded="false"><span class="chapter-number attention-${escapeHtml(chapter.attention)}">${index + 1}</span><span class="chapter-copy"><strong>${escapeHtml(chapter.title)}</strong><small>${escapeHtml(chapter.synopsis)}</small><span class="chapter-tags">${chapter.riskCategories.map((risk) => `<span class="chapter-tag">${categoryIcon(risk)}${escapeHtml(risk)}</span>`).join("")}</span></span><span class="chevron">⌄</span></button><div class="chapter-detail" hidden>${renderSemantic(chapter.before, chapter.after)}${focusedEvidence ? `<div class="evidence-stack">${focusedEvidence}</div>` : ""}</div></article>`;
  }).join("");
}

function categoryIcon(category: string): string {
  const paths: Record<string, string> = {
    behavior: '<path d="M3 8h12M10 4l4 4-4 4"/>',
    security: '<path d="M9 2l5 2v4c0 3.2-2 5.7-5 6.8C6 13.7 4 11.2 4 8V4l5-2z"/><path d="M7 8l1.3 1.3L11 6.6"/>',
    performance: '<path d="M10 2L4 10h4l-1 6 6-8H9l1-6z"/>',
    refactor: '<path d="M5 3v10M5 3l-2 2M5 3l2 2M13 13V3M13 13l-2-2M13 13l2-2"/>',
    formatting: '<path d="M3 4h10M3 8h7M3 12h10"/>',
  };
  return `<svg class="tag-icon" viewBox="0 0 18 18" aria-hidden="true">${paths[category] ?? '<circle cx="9" cy="9" r="3"/>'}</svg>`;
}

function navIcon(view: "story" | "timeline" | "diff" | "tests"): string {
  const paths: Record<typeof view, string> = {
    story: '<circle cx="5" cy="4" r="1.5"/><circle cx="5" cy="12" r="1.5"/><path d="M5 5.5v5M9 4h4M9 12h4"/>',
    timeline: '<circle cx="9" cy="9" r="5.5"/><path d="M9 5.5v3.8l2.5 1.5"/>',
    diff: '<path d="M6.5 5L3 9l3.5 4M11.5 5L15 9l-3.5 4"/>',
    tests: '<path d="M3.5 9.5l3.2 3.2 6.8-7"/>',
  };
  return `<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 18 18">${paths[view]}</svg></span>`;
}

function renderSemantic(before: string | undefined, after: string | undefined): string {
  if (before === undefined && after === undefined) return "";
  return `<div class="semantic"><div><strong>Before</strong><p>${escapeHtml(before ?? "Not inferred from this patch.")}</p></div><div><strong>After</strong><p>${escapeHtml(after ?? "Not inferred from this patch.")}</p></div></div>`;
}

function renderEvidence(hunk: DiffHunk, path: string, highlighter: Highlighter): string {
  const focused = focusedEvidenceLines(hunk.lines);
  if (focused.length === 0) return "";
  const language = resolveLanguage(path);
  let previousIndex = -1;
  const excerpt = focused.map(({ line, index }) => {
    const omission = previousIndex >= 0 && index > previousIndex + 1 ? renderOmission() : "";
    previousIndex = index;
    return `${omission}${renderEvidenceLine(line, language, highlighter)}`;
  }).join("");
  const raw = hunk.lines.map((line) => renderEvidenceLine(line, language, highlighter)).join("");
  const omittedCount = hunk.lines.length - focused.length;
  return `<article class="evidence focused-evidence"><header><span>▱ ${escapeHtml(path)}</span><span class="focused-label">Focused excerpt · @@ −${hunk.oldStart} +${hunk.newStart} @@</span><span class="raw-label">Complete excerpt · @@ −${hunk.oldStart} +${hunk.newStart} @@</span></header><pre class="focused-code">${excerpt}</pre><pre class="raw-code">${raw}</pre>${omittedCount > 0 ? `<p class="evidence-context">${omittedCount} routine line${omittedCount === 1 ? "" : "s"} omitted</p>` : ""}</article>`;
}

function renderEvidenceLine(line: DiffLine, language: BundledLanguage, highlighter: Highlighter): string {
  return `<span class="line ${line.kind}"><b>${line.oldLine ?? ""}</b><b>${line.newLine ?? ""}</b><code><span class="diff-prefix">${linePrefix(line.kind)}</span>${highlightCode(line.content, language, highlighter)}</code></span>`;
}

function renderOmission(): string {
  return `<span class="line omission" aria-label="Routine lines omitted"><span class="omission-divider"><i></i><b>⌁</b><i></i></span></span>`;
}

function focusedEvidenceLines(lines: DiffLine[]): Array<{ line: DiffLine; index: number }> {
  const changed = lines
    .map((line, index) => ({ line, index, score: evidenceLineScore(line) }))
    .filter(({ line, score }) => line.kind !== "context" && score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 10)
    .sort((left, right) => left.index - right.index);
  if (changed.length === 0) return [];

  const selected = new Set(changed.map(({ index }) => index));
  for (const { index } of changed) {
    for (const neighbour of [index - 1, index + 1]) {
      const line = lines[neighbour];
      if (line?.kind === "context" && !isRoutineLine(line.content)) selected.add(neighbour);
    }
  }
  return [...selected].sort((left, right) => left - right).map((index) => ({ line: lines[index]!, index }));
}

function evidenceLineScore(line: DiffLine): number {
  if (line.kind === "context" || isRoutineLine(line.content)) return 0;
  const source = line.content.trim();
  let score = 10;
  if (/\b(?:export|function|class|interface|type|return|throw|await|if|switch|for|while|catch)\b/.test(source)) score += 8;
  if (/=>|\w+\s*\(/.test(source)) score += 4;
  if (/\b(?:TODO|FIXME|NOTE)\b/.test(source)) score += 2;
  return score;
}

function isRoutineLine(source: string): boolean {
  const line = source.trim();
  return line.length === 0
    || /^[{}[\]();,]+$/.test(line)
    || /^(?:get|set)\s+[A-Za-z_$][\w$]*\s*\(/.test(line)
    || /^(?:constructor|init)\s*\([^)]*\)\s*\{\s*\}$/.test(line)
    || /^(?:(?:public|private|protected|readonly|static|declare|abstract|override)\s+)*(?:[A-Za-z_$][\w$]*[!?]?\s*(?::[^=;]+)?\s*=\s*(?:undefined|null|true|false|0|""|''|\[\]|\{\})\s*;?)$/.test(line);
}

function isSupportingFile(file: ChangedFile | undefined): boolean {
  return file?.signal === "low-signal" || /(?:^|\/)(?:\.gitignore|license(?:\.[^/]+)?|readme(?:\.[^/]+)?)$/i.test(file?.path ?? "");
}

function renderOtherFilesChanged(files: ChangedFile[], hunks: DiffHunk[]): string {
  const rows = files.flatMap((file) => {
    if (!isSupportingFile(file)) return [];
    const changes = hunks.filter((hunk) => hunk.fileId === file.id).flatMap((hunk) => hunk.lines);
    const additions = changes.filter((line) => line.kind === "addition").length;
    const deletions = changes.filter((line) => line.kind === "deletion").length;
    return additions + deletions > 0 ? [{ path: file.path, additions, deletions }] : [];
  });
  if (rows.length === 0) return "";
  return `<section class="other-files" aria-label="Other files changed"><h2>Other files changed</h2><ul>${rows.map((row) => `<li><span>${escapeHtml(row.path)}</span><small><b class="additions">+${row.additions}</b><b class="deletions">−${row.deletions}</b></small></li>`).join("")}</ul></section>`;
}

function renderFullDiff(file: ChangedFile, hunks: DiffHunk[], highlighter: Highlighter): string {
  const parsed = parseDiff(toUnifiedDiff(file, hunks), { drawFileList: false, outputFormat: "line-by-line" })[0];
  if (parsed === undefined) return "";
  const language = resolveLanguage(file.path);
  return `<details class="file full-diff-file" open><summary><span>▱ ${escapeHtml(file.path)}</span><small>${escapeHtml(file.signalReason ?? file.status)}</small></summary>${parsed.blocks.map((block) => renderDiffBlock(block, language, highlighter)).join("")}</details>`;
}

function toUnifiedDiff(file: ChangedFile, hunks: DiffHunk[]): string {
  const path = file.path.replace(/\\/g, "/");
  const header = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  const blocks = hunks.map((hunk) => {
    const oldCount = hunk.lines.filter((line) => line.kind !== "addition").length;
    const newCount = hunk.lines.filter((line) => line.kind !== "deletion").length;
    return [`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`, ...hunk.lines.map((line) => `${linePrefix(line.kind)}${line.content}`)].join("\n");
  });
  return [...header, ...blocks].join("\n");
}

function renderDiffBlock(block: DiffBlock, language: BundledLanguage, highlighter: Highlighter): string {
  const tokenLines = highlighter.codeToTokens(block.lines.map((line) => line.content.slice(1)).join("\n"), { lang: language, theme: "github-light" }).tokens;
  return `<div class="diff-block"><div class="diff-hunk-header">${escapeHtml(block.header)}</div><pre>${block.lines.map((line, index) => renderDiffLine(line, tokenLines[index] ?? [])).join("")}</pre></div>`;
}

function renderDiffLine(line: ParsedDiffLine, tokens: Array<{ content: string; color?: string; fontStyle?: number }>): string {
  const kind = line.type === "insert" ? "addition" : line.type === "delete" ? "deletion" : "context";
  return `<span class="line ${kind}"><b>${line.oldNumber ?? ""}</b><b>${line.newNumber ?? ""}</b><code><span class="diff-prefix">${escapeHtml(line.content.slice(0, 1))}</span>${renderTokens(tokens)}</code></span>`;
}

function linePrefix(kind: DiffLine["kind"]): string {
  return kind === "addition" ? "+" : kind === "deletion" ? "-" : " ";
}

function highlightCode(source: string, language: BundledLanguage, highlighter: Highlighter): string {
  return renderTokens(highlighter.codeToTokens(source, { lang: language, theme: "github-light" }).tokens[0] ?? []);
}

function renderTokens(tokens: Array<{ content: string; color?: string; fontStyle?: number }>): string {
  return tokens.map((token) => `<span${token.color === undefined ? "" : ` style="color:${token.color}"`}${token.fontStyle === 1 ? ' class="token-italic"' : ""}>${escapeHtml(token.content)}</span>`).join("");
}

async function syntaxHighlighter(files: ChangedFile[]): Promise<Highlighter> {
  const highlighter = await getSingletonHighlighter({ themes: ["github-light"], langs: [] });
  await Promise.all([...new Set(files.map((file) => resolveLanguage(file.path)))].map((language) => highlighter.loadLanguage(language)));
  return highlighter;
}

function resolveLanguage(path: string): BundledLanguage {
  const byExtension: Record<string, BundledLanguage> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", json: "json", css: "css", html: "html", htm: "html", md: "markdown", mdx: "mdx", yml: "yaml", yaml: "yaml", swift: "swift", py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", sh: "shellscript", zsh: "shellscript", bash: "shellscript", sql: "sql", xml: "xml", vue: "vue", svelte: "svelte",
  };
  const extension = path.toLowerCase().split(".").at(-1) ?? "";
  return byExtension[extension] ?? "text";
}

function renderOmitted(document: AnalysisDocument, hunks: DiffHunk[]): string {
  const count = document.omittedGroups.reduce((sum, group) => sum + group.evidenceIds.length, 0);
  return count === 0 ? "" : `<details class="omitted"><summary>${count} low-signal hunks collapsed</summary>${document.omittedGroups.map((group) => `<p><strong>${escapeHtml(group.title)}</strong> · ${escapeHtml(group.reason)}</p>`).join("")}</details>`;
}

function renderTestPlan(document: AnalysisDocument, hunks: DiffHunk[], filePaths: Map<string, string>): string {
  const tests = document.chapters.filter((chapter) => chapter.kind === "test");
  return tests.length === 0 ? `<p class="empty-note">No dedicated test change was identified.</p>` : tests.map((chapter) => {
    const evidence = chapter.evidenceIds.map((id) => requireHunk(hunks, id));
    const cases = evidence.flatMap((hunk) => hunk.lines.filter((line) => line.kind === "addition").map((line) => line.content.match(/(?:it|test)\s*\(\s*["'`]([^"'`]+)/)?.[1]).filter((name): name is string => name !== undefined).map((name) => ({ name, hunk })));
    return `<article class="test-group"><h2>${escapeHtml(chapter.title)}</h2><p>${escapeHtml(chapter.synopsis)}</p><ul>${cases.length ? cases.map(({ name, hunk }) => `<li><button data-timeline-chapter="${escapeHtml(chapter.id)}" data-test-hunk="${escapeHtml(hunk.id)}"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(filePaths.get(hunk.fileId) ?? hunk.fileId)}</small></button></li>`).join("") : evidence.map((hunk) => `<li><button data-timeline-chapter="${escapeHtml(chapter.id)}" data-test-hunk="${escapeHtml(hunk.id)}"><strong>Verify ${escapeHtml(filePaths.get(hunk.fileId) ?? hunk.fileId)}</strong><small>Open the focused test evidence</small></button></li>`).join("")}</ul></article>`;
  }).join("");
}

function requireHunk(hunks: DiffHunk[], id: string): DiffHunk {
  const hunk = hunks.find((candidate) => candidate.id === id);
  if (hunk === undefined) throw new Error(`Unknown hunk ${id}`);
  return hunk;
}

function attentionCounts(document: AnalysisDocument): Record<string, number> {
  const counts: Record<string, number> = { low: 0, contained: 0, elevated: 0, high: 0, critical: 0 };
  for (const chapter of document.chapters) counts[chapter.attention] += 1;
  return counts;
}

function categoryCounts(document: AnalysisDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const chapter of document.chapters) for (const category of chapter.riskCategories) counts[category] = (counts[category] ?? 0) + 1;
  return counts;
}

function basename(path: string): string { return path.split("/").filter(Boolean).at(-1) ?? path; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char); }

export const styles = `
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f1f1f;background:#fff}*{box-sizing:border-box}html{overflow-x:hidden}body{margin:0;background:#fff;font-size:13px;min-width:320px}.app-shell{display:grid;grid-template-columns:240px minmax(580px,1fr) 272px;min-height:100vh}.sidebar{background:#f6f7f8;border-right:1px solid #e7e7e7;padding:20px 10px;position:sticky;top:0;height:100vh}.brand{font-size:17px;font-weight:620;padding:11px 12px 34px;letter-spacing:-.2px}.brand-mark{display:inline-grid;place-items:center;width:22px;height:22px;color:#111;margin-right:7px}.sidebar nav{display:grid;gap:2px}.nav-item{border:0;background:transparent;color:#555;display:flex;align-items:center;gap:10px;width:100%;min-height:40px;padding:10px 12px;border-radius:8px;font:500 14px inherit;text-align:left;cursor:pointer}.nav-item span{width:16px;text-align:center;color:#666}.nav-item:hover{background:#ededee}.nav-item.active{background:#e7f2ff;color:#1477da}.nav-item.active span{color:#1477da}.sidebar-bottom{position:absolute;bottom:18px;left:10px;right:10px}.main{min-width:0;max-width:1100px;padding:44px 34px 80px;margin:0 auto;width:100%}.page-header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:1px solid #e9e9e9;padding-bottom:22px}.page-header h1{margin:0 0 11px;font-size:27px;letter-spacing:-.5px;font-weight:650}.breadcrumbs{display:flex;gap:13px;align-items:center;color:#6d6d6d;font-size:12px;flex-wrap:wrap}.breadcrumbs code{background:#f5f5f5;border:1px solid #e9e9e9;border-radius:5px;padding:4px 7px;color:#444}.header-controls{display:flex;align-items:center;gap:10px}.lens-label,.artifact-label{display:flex;align-items:center;gap:7px;color:#777;font-size:12px}.artifact-label{border:1px solid #e2e2e2;border-radius:7px;min-height:36px;padding:8px 10px;white-space:nowrap}.lens-label select{border:1px solid #dedede;border-radius:7px;background:#fff;padding:8px 26px 8px 10px;color:#333;font:inherit;min-height:36px}.zoom{display:flex;border:1px solid #e2e2e2;border-radius:7px;padding:2px}.zoom button{border:0;border-radius:5px;background:transparent;min-height:32px;padding:6px 8px;color:#777;font-size:11px;cursor:pointer}.zoom button.active{background:#f1f1f1;color:#333;font-weight:600}.notice,.artifact-notice{display:flex;justify-content:space-between;align-items:center;background:#f6f9ff;border:1px solid #d5e8ff;border-radius:8px;margin-top:15px;padding:10px 12px;color:#4e6477;font-size:12px}.artifact-notice{background:#fafafa;border-color:#e7e7e7;color:#666}.notice button,.inspector-action{border:1px solid #d8d8d8;background:#fff;border-radius:7px;min-height:36px;padding:7px 10px;font:500 12px inherit;cursor:pointer;color:#333}.notice button{border-color:#2388e8;background:#2388e8;color:#fff}.view{display:none}.view.active{display:block}.review-summary{font-size:16px;line-height:1.5;color:#3f3f3f;margin:27px 0 5px;max-width:780px}.coverage{font-size:12px;color:#8a8a8a;margin:0 0 18px}.map{display:flex;gap:7px;flex-wrap:wrap;border:1px solid #e6e6e6;border-radius:8px;padding:10px;margin-bottom:12px}.map div{font-size:11px;color:#666}.map strong{margin-left:3px;color:#333}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px;background:#70bd89}.dot.contained{background:#54a6e8}.dot.elevated{background:#e7a92b}.dot.high{background:#ec7f45}.dot.critical{background:#e65f5f}.chapter-list{border:1px solid #e3e3e3;border-radius:9px;overflow:hidden}.chapter{border-bottom:1px solid #e8e8e8}.chapter:last-child{border-bottom:0}.chapter-toggle{display:grid;grid-template-columns:34px minmax(150px,1fr) 82px minmax(90px,auto) 16px;align-items:center;gap:12px;width:100%;min-height:58px;padding:13px;background:#fff;border:0;text-align:left;cursor:pointer}.chapter-toggle:hover{background:#fafafa}.chapter.open .chapter-toggle{background:#f9fcff;box-shadow:inset 2px 0 #2f94ed}.chapter-number{border:1px solid #e1e1e1;border-radius:7px;width:30px;height:30px;display:grid;place-items:center;color:#666;font-size:13px}.chapter.open .chapter-number{border-color:#bde0ff;color:#1680df;background:#f4faff}.chapter-copy{display:grid;gap:3px;min-width:0}.chapter-copy strong{font-size:13px;font-weight:620;color:#282828}.chapter-copy small{font-size:12px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.attention{display:flex;align-items:center;gap:5px;font-size:11px;color:#666;position:relative;text-transform:capitalize}.attention i{width:7px;height:7px;border-radius:50%;background:#70bd89}.attention.contained i{background:#54a6e8}.attention.elevated i{background:#e7a92b}.attention.high i{background:#ec7f45}.attention.critical i{background:#e65f5f}.attention:hover:after{content:attr(data-tooltip);position:absolute;top:18px;left:0;z-index:5;width:200px;border:1px solid #ddd;background:#fff;box-shadow:0 8px 20px #00000016;border-radius:7px;padding:8px;color:#555;line-height:1.4;text-transform:none}.category{font-size:11px;color:#555;background:#f6f6f6;padding:5px 7px;border-radius:6px;white-space:nowrap}.chevron{color:#888;font-size:14px}.chapter-detail{padding:16px 18px 20px 64px;background:#fff}.semantic{display:grid;grid-template-columns:1fr 1fr;gap:20px;border-bottom:1px solid #ececec;padding-bottom:15px;margin-bottom:16px}.semantic>div+div{border-left:1px solid #ececec;padding-left:20px}.semantic strong{font-size:11px;color:#555}.semantic p{font-size:12px;color:#777;line-height:1.45;margin:4px 0 0}.evidence{border:1px solid #e1e1e1;border-radius:8px;overflow:hidden;margin-top:10px}.evidence header{display:flex;justify-content:space-between;gap:12px;background:#fafafa;border-bottom:1px solid #ededed;padding:9px 11px;font-size:11px;color:#666}.evidence pre{margin:0;background:#fff;padding:7px 0;overflow:auto;-webkit-overflow-scrolling:touch;font:12px/1.58 ui-monospace,SFMono-Regular,Menlo,monospace}.line{display:grid;grid-template-columns:38px 38px 1fr;min-width:max-content;padding:0 11px}.line b{font-weight:400;color:#a0a0a0;text-align:right;padding-right:10px;user-select:none}.line.add{background:#eaf8ee;color:#276b3d}.line.deletion{background:#fff0ef;color:#a6534a}.line code{font:inherit}.omitted{margin-top:15px;border:1px dashed #d6d6d6;border-radius:8px;padding:11px 13px;color:#777;font-size:12px}.omitted summary{cursor:pointer;color:#555}.omitted p{margin:8px 0 0}.section-title{font-size:13px;font-weight:600;margin:28px 0 15px}.timeline{border-left:1px solid #dcdcdc;margin:30px 0 0 9px;padding-left:25px}.timeline article{display:flex;gap:14px;position:relative;padding-bottom:25px}.timeline article:before{content:"";width:9px;height:9px;border-radius:50%;background:#278fe8;border:3px solid #fff;box-shadow:0 0 0 1px #cddfec;position:absolute;left:-31px;top:3px}.timeline article>span{color:#278fe8;font-size:11px;font-weight:650}.timeline h2{font-size:13px;margin:0 0 4px}.timeline p{margin:0;color:#777;line-height:1.45}.file{border:1px solid #e1e1e1;border-radius:8px;margin:10px 0;overflow:hidden}.file summary{display:flex;justify-content:space-between;gap:12px;background:#fafafa;padding:10px 12px;cursor:pointer;color:#444;font-size:12px}.file summary small{color:#888}.inspector{background:#fff;border-left:1px solid #e8e8e8;padding:28px 18px;height:100vh;position:sticky;top:0}.inspector h2{font-size:14px;margin:0 0 18px}.progress{display:flex;align-items:center;gap:12px;padding-bottom:20px;border-bottom:1px solid #ececec}.ring{width:43px;height:43px;border-radius:50%;display:grid;place-items:center;border:4px solid #dceeff;border-top-color:#2a94ec;color:#333;font-size:12px;font-weight:650}.progress strong{display:block;font-size:12px}.progress span{display:block;font-size:11px;color:#888;margin-top:2px}.inspector section{border-bottom:1px solid #ececec;padding:18px 0}.inspector h3{font-size:11px;margin:0 0 11px}.stat-row{display:flex;justify-content:space-between;color:#666;font-size:12px;padding:5px 0}.stat-row strong{color:#333;font-weight:600}.inspector-action{display:block;width:100%;margin-top:8px}.saved{font-size:11px;color:#777;margin-top:18px}.saved::first-letter{color:#54b978}.notes{margin-top:27px;border-top:1px solid #ececec;padding-top:18px}.notes h2{font-size:13px;margin:0 0 10px}.empty-note{font-size:12px;color:#888}.question{border-left:2px solid #278fe8;padding:8px 10px;margin:9px 0;color:#555;background:#fafcff;font-size:12px;line-height:1.45}.question strong{color:#333}.question small{display:block;color:#888;margin-top:5px}.selection-menu{position:fixed;z-index:10;display:flex;gap:3px;max-width:calc(100vw - 16px);overflow-x:auto;padding:4px;border:1px solid #ddd;border-radius:8px;background:#fff;box-shadow:0 8px 20px #0000001f}.selection-menu button{border:0;background:#fff;min-height:36px;padding:7px 8px;border-radius:5px;color:#444;font-size:11px;cursor:pointer;white-space:nowrap}.selection-menu button:hover{background:#f1f7ff;color:#197ed6}.toast{position:fixed;right:20px;bottom:20px;z-index:20;max-width:calc(100vw - 32px);background:#242424;color:#fff;border-radius:8px;padding:10px 12px;font-size:12px;box-shadow:0 8px 22px #0002}@media(max-width:1120px){.app-shell{grid-template-columns:210px minmax(0,1fr)}.inspector{display:none}}@media(max-width:760px){.app-shell{display:block}.sidebar{height:auto;position:static;border-right:0;border-bottom:1px solid #e7e7e7;padding:10px 12px}.brand{padding:5px 4px 10px;margin:0}.sidebar nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.nav-item{justify-content:center;gap:5px;min-height:44px;padding:8px 4px;text-align:center;font-size:12px}.nav-item span{width:auto}.sidebar-bottom{display:none}.main{padding:24px 14px 56px}.page-header{display:block}.page-header h1{font-size:24px;margin-bottom:9px}.breadcrumbs{gap:6px;font-size:11px}.header-controls{display:grid;grid-template-columns:1fr;margin-top:14px;gap:10px}.lens-label{justify-content:space-between}.lens-label select{flex:1;max-width:240px}.zoom{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));width:100%}.zoom button{min-height:38px;padding:5px 2px;font-size:10px}.notice,.artifact-notice{align-items:flex-start;gap:10px;flex-direction:column}.notice button{width:100%}.artifact-label{justify-content:center}.review-summary{font-size:15px;margin-top:22px}.coverage{line-height:1.45}.chapter-toggle{grid-template-columns:32px minmax(0,1fr) 18px;grid-template-areas:"number copy chevron" "number attention chevron";column-gap:10px;row-gap:5px;min-height:74px;padding:12px}.chapter-number{grid-area:number}.chapter-copy{grid-area:copy}.chapter-copy small{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}.attention{grid-area:attention;font-size:10px}.category{display:none}.chevron{grid-area:chevron}.chapter-detail{padding:14px}.semantic{grid-template-columns:1fr;gap:12px}.semantic>div+div{border-left:0;border-top:1px solid #ececec;padding:12px 0 0}.evidence header{align-items:flex-start;flex-direction:column;gap:3px}.evidence pre{font-size:11px}.line{grid-template-columns:32px 32px 1fr;padding:0 8px}.file summary{align-items:flex-start;flex-direction:column;gap:3px}.timeline{margin-top:24px;padding-left:20px}.timeline article:before{left:-26px}.selection-menu{left:8px!important;right:8px;bottom:8px;top:auto!important}.toast{right:16px;bottom:16px}.map{gap:10px}.notes{margin-top:22px}}@media(max-width:380px){.nav-item{font-size:11px}.nav-item span{display:none}.breadcrumbs code{font-size:10px}.chapter-toggle{padding:11px}.main{padding-left:12px;padding-right:12px}}
`;

const enhancementStyles = `.brand-mark{width:28px;height:22px;margin:0 7px 0 0}.brand-mark path{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}.collapse-sidebar{margin-left:auto;border:0;background:transparent;font-size:22px;cursor:pointer}.sidebar.collapsed{width:54px;padding:20px 6px}.sidebar.collapsed .brand{font-size:0}.sidebar.collapsed .nav-item{font-size:0;justify-content:center}.sidebar.collapsed .nav-item span{font-size:14px}.sidebar.collapsed .collapse-sidebar{transform:rotate(180deg)}.story-tools{display:flex;justify-content:space-between;align-items:center}.story-tools button,.zoom-info{border:1px solid #ddd;background:#fff;border-radius:50%;width:28px;height:28px;cursor:pointer}.story-tools button{border-radius:7px;width:auto;padding:0 10px;font-size:12px}.story-zoom-controls{display:flex;align-items:center;gap:5px;height:96px;padding-top:60px}.story-zoom-controls[hidden]{display:none!important}.zoom{position:relative;width:188px;height:24px;display:flex;justify-content:space-between;align-items:center;padding:0 10px;background:linear-gradient(#cfd5da,#cfd5da) center/calc(100% - 20px) 1px no-repeat;border:0}.zoom button{position:relative;width:17px;height:17px;min-height:17px;padding:0;border-radius:50%;background:#b7bec5;border:3px solid #fff;box-shadow:0 0 0 1px #aeb7bf;z-index:2;transition:transform 180ms ease,background-color 180ms ease,box-shadow 180ms ease}.zoom button:hover{background:#6d9fce;transform:scale(1.12)}.zoom button.active{background:#2188eb;box-shadow:0 0 0 3px #d7ebff;transform:scale(1.15)}.zoom-callout{--zoom-position:.25;--edge-offset:0px;position:absolute;left:calc(18.5px + (100% - 37px) * var(--zoom-position));bottom:calc(50% + 19px);z-index:3;min-width:122px;max-width:150px;padding:9px 11px 10px;border:1px solid #cbd6df;border-radius:13px;background:#fff;color:#1f2933;box-shadow:0 8px 18px #172b4d14;transform:translateX(calc(-50% + var(--edge-offset)));transition:left 260ms cubic-bezier(.2,.8,.2,1),transform 180ms ease,opacity 180ms ease;text-align:center;pointer-events:none}.zoom-callout::after{content:"";position:absolute;left:calc(50% - var(--edge-offset));bottom:-6px;width:11px;height:11px;border-right:1px solid #cbd6df;border-bottom:1px solid #cbd6df;background:#fff;transform:translateX(-50%) rotate(45deg)}.zoom-callout output{display:block;font-size:11px;font-weight:700;color:#176fbf;letter-spacing:.01em}.zoom-callout span{display:block;margin-top:3px;font-size:10px;line-height:1.25;color:#68747f}.zoom.is-changing .zoom-callout{transform:translateX(calc(-50% + var(--edge-offset))) translateY(3px);opacity:.72}.zoom-info{font-family:Georgia,serif;font-weight:700}.tok-keyword{color:#8b3bb3;font-style:normal}.tok-string{color:#157347;font-style:normal}.tok-number{color:#b45309;font-style:normal}.timeline button{display:flex;width:100%;border:0;background:transparent;text-align:left;gap:14px;cursor:pointer;padding:0 0 25px}.timeline button:hover h2{color:#167cd1}.chapter-list,.map,.chapter-detail,.semantic,.evidence-stack,.evidence{transition:opacity 220ms ease,transform 220ms ease,max-height 260ms ease,margin 220ms ease,padding 220ms ease}.chapter-detail{max-height:0;opacity:0;overflow:hidden;padding-top:0;padding-bottom:0;transform:translateY(-5px)}.chapter.open .chapter-detail{max-height:4000px;opacity:1;padding-top:16px;padding-bottom:20px;transform:translateY(0)}.raw-code,.raw-label{display:none}.story-level-0 .chapter-list{max-height:0;opacity:0;overflow:hidden;transform:translateY(-8px);pointer-events:none}.story-level-0 .map,.zoom-revealed{animation:story-enter 260ms ease both}.story-level-1 .chapter-detail{max-height:0!important;opacity:0!important;padding-top:0!important;padding-bottom:0!important;transform:translateY(-5px)!important}.story-level-1 .chevron{display:none}.story-level-2 .evidence-stack{display:none}.story-level-3 .evidence{max-height:210px;overflow:hidden}.story-level-4 .evidence{max-height:2000px}.story-level-4 .focused-code,.story-level-4 .focused-label,.story-level-4 .evidence-context{display:none}.story-level-4 .raw-code{display:block}.story-level-4 .raw-label{display:inline}@keyframes story-enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.zoom button,.zoom-callout,.chapter-list,.map,.chapter-detail,.semantic,.evidence-stack,.evidence{transition:none!important;animation:none!important}}@media(max-width:760px){.sidebar.collapsed{width:auto}.sidebar.collapsed .brand{font-size:17px}.sidebar.collapsed .nav-item{font-size:12px}.sidebar.collapsed .nav-item span{font-size:inherit}.story-zoom-controls{width:100%;height:104px;padding-top:66px;justify-content:center}.zoom{width:min(100%,300px);flex:1}.zoom-callout{min-width:116px;padding:8px 9px}.zoom-callout[data-edge="start"]{--edge-offset:14px}.zoom-callout[data-edge="end"]{--edge-offset:-14px}.chapter.open .chapter-detail{padding:14px}.header-controls>button[data-zoom-step],.story-zoom-controls>button[data-zoom-step]{width:34px;height:36px;font-size:21px}}`;

const panelStyles = `
.app-shell{grid-template-columns:240px minmax(0,1fr) 272px;transition:grid-template-columns 220ms ease}.main{max-width:none}.panel-toggle{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:7px;background:transparent;color:#59636d;font:20px/1 inherit;cursor:pointer}.panel-toggle:hover{background:#eaedf0;color:#1f2933}.sidebar.collapsed{width:auto;padding:20px 6px}.app-shell.sidebar-collapsed{grid-template-columns:54px minmax(0,1fr) 272px}.sidebar.collapsed .brand-name{display:none}.sidebar.collapsed .brand{padding:11px 6px 34px}.sidebar.collapsed .brand-mark{margin:0}.sidebar.collapsed .nav-item{font-size:0;justify-content:center}.sidebar.collapsed .nav-item span{font-size:14px}.sidebar.collapsed .collapse-sidebar{transform:rotate(180deg)}.mobile-inspector-toggle{display:none}.inspector{display:block;padding:22px 18px}.inspector-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:18px}.inspector h2{margin:0}.collapse-inspector{font-size:24px}.app-shell.inspector-collapsed{grid-template-columns:240px minmax(0,1fr) 54px}.app-shell.sidebar-collapsed.inspector-collapsed{grid-template-columns:54px minmax(0,1fr) 54px}.inspector-content{min-width:0}.inspector-collapsed .inspector{padding:20px 6px}.inspector-collapsed .inspector-header{justify-content:center}.inspector-collapsed .inspector h2,.inspector-collapsed .inspector-content{display:none}.inspector-collapsed .collapse-inspector{transform:rotate(180deg)}
@media(max-width:1120px){.app-shell{grid-template-columns:210px minmax(0,1fr) 228px}.app-shell.sidebar-collapsed{grid-template-columns:54px minmax(0,1fr) 228px}.app-shell.inspector-collapsed{grid-template-columns:210px minmax(0,1fr) 54px}.app-shell.sidebar-collapsed.inspector-collapsed{grid-template-columns:54px minmax(0,1fr) 54px}.main{padding:36px 26px 64px}}
@media(max-width:760px){.app-shell,.app-shell.sidebar-collapsed,.app-shell.inspector-collapsed,.app-shell.sidebar-collapsed.inspector-collapsed{display:block}.sidebar{height:auto;position:sticky;z-index:4;top:0;padding:8px 12px;background:#f6f7f8}.brand,.sidebar.collapsed .brand{display:flex;align-items:center;padding:5px 2px 9px;font-size:17px}.brand-name,.sidebar.collapsed .brand-name{display:inline}.brand-mark,.sidebar.collapsed .brand-mark{margin-right:7px}.collapse-sidebar{margin-left:auto}.mobile-inspector-toggle{display:grid;margin-left:4px}.sidebar nav{max-height:240px;overflow:hidden;transition:max-height 180ms ease,margin 180ms ease}.sidebar.collapsed nav{max-height:0;margin:0}.sidebar.collapsed .nav-item{font-size:12px;justify-content:center}.sidebar.collapsed .nav-item span{font-size:inherit}.main{padding:22px 14px 56px}.inspector{display:none}.app-shell.mobile-inspector-open .inspector{display:block;position:fixed;z-index:10;inset:auto 8px 8px 8px;height:auto;max-height:min(78vh,620px);overflow:auto;border:1px solid #dce2e7;border-radius:12px;padding:18px;background:#fff;box-shadow:0 18px 50px #172b4d26}.app-shell.mobile-inspector-open .inspector-content{display:block}.app-shell.mobile-inspector-open .inspector-header{margin-bottom:14px}.app-shell.mobile-inspector-open .inspector h2{display:block}.app-shell.mobile-inspector-open .collapse-inspector{transform:rotate(180deg)}.inspector-collapsed .inspector{padding:18px}.inspector-collapsed .inspector h2,.inspector-collapsed .inspector-content{display:block}.inspector-collapsed .inspector-header{justify-content:space-between}.inspector-collapsed .collapse-inspector{transform:rotate(180deg)}}
@media(prefers-reduced-motion:reduce){.app-shell,.sidebar nav{transition:none}}
`;

const conceptPolishStyles = `
.panel-toggle{width:38px;height:38px;border:1px solid #dfe4e8;border-radius:7px;background:#fff;color:#3d4751;font-size:21px;font-weight:500;box-shadow:0 1px 2px #172b4d0a;transition:background-color 160ms ease,border-color 160ms ease,color 160ms ease,transform 160ms ease}.panel-toggle:hover{background:#f7fafc;border-color:#c8d2dc;color:#146fd0}.panel-toggle:focus-visible,.nav-item:focus-visible{outline:2px solid #167ee7;outline-offset:2px}.brand{position:relative;display:flex;align-items:center;min-height:62px}.collapse-sidebar{position:absolute;top:10px;left:calc(100% - 50px);margin:0;transition:left 220ms ease,top 220ms ease,transform 220ms ease}.sidebar.collapsed .brand{min-height:102px;padding:10px 0}.sidebar.collapsed .brand-mark{position:absolute;top:10px;left:7px;margin:0}.sidebar.collapsed .collapse-sidebar{top:52px;left:2px;transform:rotate(180deg)}.sidebar nav{gap:5px}.nav-item{position:relative;min-height:46px;padding:11px 13px;border-radius:7px;font-size:14px;font-weight:560;color:#4e5964;transition:background-color 160ms ease,color 160ms ease}.nav-item span{width:24px;font-size:20px;line-height:1;color:#596773;transition:color 160ms ease,transform 160ms ease}.nav-item:hover{background:#edf1f5;color:#1e2933}.nav-item:hover span{color:#1e2933;transform:scale(1.04)}.nav-item.active{border-radius:0 7px 7px 0;background:linear-gradient(90deg,#e6f2ff 0%,#f1f8ff 48%,#f6f7f8 100%);color:#126fd2;box-shadow:none}.nav-item.active::before{content:"";position:absolute;top:0;bottom:0;left:-13px;width:3px;background:#167ee7}.nav-item.active span{color:#126fd2}.sidebar.collapsed .nav-item{min-height:44px;padding:10px 0}.sidebar.collapsed .nav-item.active{box-shadow:none}.sidebar.collapsed .nav-item span{font-size:20px}.inspector-header .panel-toggle{margin-left:auto}.collapse-inspector{font-size:25px}body:not(.story-level-0) .chapter-toggle{align-items:start}body:not(.story-level-0) .chapter-copy small{display:block;white-space:normal;overflow:visible;text-overflow:clip;-webkit-line-clamp:unset}.chapter-toggle{grid-template-columns:38px minmax(0,1fr) 16px;gap:14px;padding:14px 16px}.chapter-number{width:30px;height:30px;border:0;border-radius:7px;background:#eef2f5;color:#52606d}.chapter-number.attention-contained{background:#e4f3ff;color:#1675c8}.chapter-number.attention-elevated{background:#fff4d8;color:#9a6700}.chapter-number.attention-high{background:#fff0e8;color:#c95017}.chapter-number.attention-critical{background:#ffebeb;color:#c93636}.chapter-copy strong{font-size:14px;line-height:1.3}.chapter-copy small{line-height:1.4}.chapter-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:3px}.chapter-tag{display:inline-flex;align-items:center;gap:4px;min-height:20px;padding:2px 6px;border-radius:5px;background:#f3f5f7;color:#66727f;font-size:10px;font-weight:600;text-transform:capitalize}.tag-icon{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.attention,.category{display:none}.story-toolbar{display:flex;align-items:center;gap:10px;margin:0 0 12px}.story-toolbar .map{flex:1;margin:0}.story-toolbar #collapse-all{flex:0 0 auto;min-height:32px;padding:6px 10px;border:0;border-radius:6px;background:#f1f3f5;color:#59636d;font:600 11px inherit;cursor:pointer}.story-toolbar #collapse-all:hover{background:#e5e9ed;color:#1f2933}
@media(max-width:760px){.sidebar{padding:7px 12px 0;border-bottom:0;background:#fff;box-shadow:0 1px 0 #dfe5ea}.brand,.sidebar.collapsed .brand{min-height:52px;padding:7px 2px 9px}.brand-name{color:#146fd0;font-size:19px;font-weight:650;letter-spacing:-.35px}.panel-toggle{width:38px;height:38px;border-color:#d7dfe7}.collapse-sidebar,.sidebar.collapsed .collapse-sidebar{position:static;margin-left:auto;transform:rotate(0)}.sidebar.collapsed .brand-mark{position:static;margin-right:7px}.sidebar nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin:0 -12px;max-height:240px;border-top:1px solid #dfe5ea;background:#fff}.sidebar.collapsed nav{max-height:0;border-top-color:transparent}.nav-item,.sidebar.collapsed .nav-item{min-height:68px;padding:9px 5px 8px;border-radius:0;border-right:1px solid #dfe5ea;justify-content:center;align-items:center;flex-direction:column;gap:5px;font-size:12px;font-weight:560;color:#4e5964;background:#fff}.nav-item:last-child{border-right:0}.sidebar nav .nav-item:nth-child(4):last-child{grid-column:1/-1;border-top:1px solid #dfe5ea;border-right:0;min-height:54px;flex-direction:row}.nav-item span,.sidebar.collapsed .nav-item span{width:auto;font-size:21px;color:#4e5964}.nav-item.active,.sidebar.collapsed .nav-item.active{border-radius:0;color:#126fd2;background:#fff;box-shadow:inset 0 -3px #167ee7}.nav-item.active::before{display:none}.nav-item.active span,.sidebar.collapsed .nav-item.active span{color:#126fd2}.nav-item:hover{background:#f8fbfe}.chapter-toggle{grid-template-columns:32px minmax(0,1fr) 18px;grid-template-areas:"number copy chevron";padding:13px}.chapter-number{grid-area:number}.chapter-copy{grid-area:copy}.chevron{grid-area:chevron}.chapter-tags{margin-top:5px}.main{padding-top:28px}}
@media(prefers-reduced-motion:reduce){.panel-toggle,.nav-item,.nav-item span{transition:none}}
`;

const mapStyles = `
.breadcrumbs strong{color:#374151;font-weight:650}.chapter-list{transition:opacity 220ms ease,transform 220ms ease}.nav-icon svg{display:block;width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.sidebar.collapsed nav{display:grid;grid-template-columns:1fr;justify-items:center;align-content:start}.sidebar.collapsed .nav-item{display:grid;place-items:center;width:42px;height:42px;min-height:42px;padding:0;line-height:1}.sidebar.collapsed .nav-item .nav-icon{display:grid;place-items:center;width:20px;height:20px;line-height:1;text-align:center;transform:none}.sidebar.collapsed .nav-item .nav-icon svg{width:16px;height:16px}.story-level-0 .chapter-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;max-height:none;overflow:visible;border:0;border-radius:0;opacity:1;transform:none;pointer-events:none}.story-level-0 .chapter{border:1px solid #dfe5ea;border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 1px 2px #172b4d0a;animation:map-card-in 240ms ease both}.story-level-0 .chapter-toggle{display:grid;grid-template-columns:34px minmax(0,1fr);grid-template-areas:"number copy";align-items:start;gap:12px;min-height:128px;padding:17px;cursor:default}.story-level-0 .chapter-number{grid-area:number}.story-level-0 .chapter-copy{grid-area:copy;gap:7px}.story-level-0 .chapter-copy strong{font-size:15px;line-height:1.35}.story-level-0 .chapter-copy small{display:none}.story-level-0 .chapter-tags{margin-top:2px}.story-level-0 .chevron{display:none}.story-level-0 .chapter-detail{display:none!important}.story-level-0 .chapter:hover{border-color:#dfe5ea;box-shadow:0 1px 2px #172b4d0a;transform:none}@keyframes map-card-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}@media(max-width:1120px){.story-level-0 .chapter-list{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.story-level-0 .chapter-list{grid-template-columns:1fr;gap:10px}.story-level-0 .chapter-toggle{min-height:112px}}@media(prefers-reduced-motion:reduce){.story-level-0 .chapter{animation:none;transition:none}}
`;

const zoomPolish = `.story-zoom-controls>button[data-zoom-step]{border:0;background:transparent;color:#68747f;width:28px;height:32px;border-radius:7px;font-size:19px;cursor:pointer}.story-zoom-controls>button[data-zoom-step]:hover{background:#f1f3f5;color:#222}`;

const zoomEdgePolish = `@media(max-width:760px){.zoom-callout{--callout-anchor:calc(18.5px + (100% - 37px) * var(--zoom-position));--callout-half:75px;--callout-center:clamp(calc(var(--callout-half) + 12px),var(--callout-anchor),calc(100% - var(--callout-half) - 12px));--edge-offset:0px!important;left:var(--callout-center)}.zoom-callout::after{left:calc(50% + var(--callout-anchor) - var(--callout-center))}}`;

const zoomRuntimePolish = `@media(max-width:760px){.zoom-callout{left:calc(18.5px + (100% - 37px) * var(--zoom-position));--edge-offset:0px}.zoom-callout::after{left:var(--pointer-offset,50%)}}`;

const testPlanStyles = `.test-group{border:1px solid #e3e3e3;border-radius:9px;padding:16px;margin:0 0 12px}.test-group h2{font-size:14px;margin:0 0 4px}.test-group p{margin:0 0 12px;color:#777}.test-group ul{margin:0;padding:0;list-style:none}.test-group li+li{border-top:1px solid #eee}.test-group button{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;border:0;background:transparent;padding:11px 0;text-align:left;cursor:pointer}.test-group button:hover strong{color:#197ed6}.test-group small{color:#888;white-space:nowrap}`;

const focusedEvidenceStyles = `
.focused-evidence header span:last-child{color:#7a8792}.focused-evidence .evidence-context{margin:0;padding:7px 11px;border-top:1px solid #edf0f2;background:#fbfcfd;color:#7a8792;font-size:10px}.line.omission{display:block;min-width:0;padding:3px 11px;background:#fbfcfd}.omission-divider{display:flex;align-items:center;gap:8px;color:#9aa5af}.omission-divider i{height:1px;flex:1;background:repeating-linear-gradient(135deg,#cbd4dc 0 3px,transparent 3px 6px)}.omission-divider b{font:600 14px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:-2px}.line.addition{background:#eaf8ee}.line.deletion{background:#fff0ef}.line code{color:#24292e}.diff-prefix{display:inline-block;width:1ch;color:#8c959f;user-select:none}.line.addition .diff-prefix{color:#168447}.line.deletion .diff-prefix{color:#c84c43}.token-italic{font-style:italic}.diff-block{border-top:1px solid #edf0f2}.diff-block:first-of-type{border-top:0}.diff-block pre{margin:0;padding:7px 0;overflow:auto;-webkit-overflow-scrolling:touch;font:12px/1.58 ui-monospace,SFMono-Regular,Menlo,monospace}.diff-hunk-header{padding:7px 11px;background:#f5f7f9;border-bottom:1px solid #e9edf0;color:#68747f;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.other-files{margin-top:16px;border:1px solid #e0e5e9;border-radius:10px;overflow:hidden;background:#fff}.other-files h2{margin:0;padding:12px 14px;border-bottom:1px solid #e8edf0;color:#34404b;font-size:12px;font-weight:650}.other-files ul{margin:0;padding:0;list-style:none}.other-files li{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:36px;padding:8px 14px;color:#46525d;font:12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}.other-files li+li{border-top:1px solid #eef1f3}.other-files small{display:flex;gap:7px;font:600 11px/1 inherit}.other-files .additions{color:#168447}.other-files .deletions{color:#c84c43}@media(max-width:760px){.other-files li{padding:9px 12px}.other-files li span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.line.omission{padding-left:8px;padding-right:8px}}
`;

export const clientScript = `
(() => {
  const state = ndrstnd;
  const byId = (id) => document.getElementById(id);
  const toast = (message) => { const node = byId('toast'); node.textContent = message; node.hidden = false; window.setTimeout(() => { node.hidden = true; }, 3600); };
  const api = async (path, init = {}) => { const separator = path.includes('?') ? '&' : '?'; const response = await fetch(path + separator + 'token=' + encodeURIComponent(state.token), init); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed'); return result; };
  let selectedText = '';
  let selectedLens = 'default';
  const currentStoryLevel = () => Number(document.body.dataset.storyLevel ?? 1);
  const setActiveView = (view, viewButton) => { document.querySelectorAll('[data-view]').forEach((node) => node.classList.toggle('active', node === viewButton)); document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === view)); const zoomControls = document.querySelector('.story-zoom-controls'); if (zoomControls) zoomControls.hidden = view !== 'trailer'; };

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const viewButton = target.closest('[data-view]');
    if (viewButton) { setActiveView(viewButton.getAttribute('data-view'), viewButton); return; }
    const zoomButton = target.closest('[data-zoom]');
    if (zoomButton) { const zoom = Number(zoomButton.getAttribute('data-zoom')); document.querySelectorAll('[data-zoom]').forEach((node) => node.classList.toggle('active', node === zoomButton)); byId('map').hidden = zoom !== 0; if (zoom >= 3) document.querySelectorAll('.chapter').forEach((node) => openChapter(node, true)); try { await api('/api/preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zoom }) }); } catch {} return; }
    const chapterButton = target.closest('.chapter-toggle');
    if (chapterButton) { if (currentStoryLevel() <= 1) return; const chapter = chapterButton.closest('.chapter'); openChapter(chapter, !chapter.classList.contains('open')); return; }
    const rerun = target.closest('#rerun');
    if (rerun) { toast('Rebuilding the review narrative…'); try { await api('/api/session/' + state.sessionId + '/reanalyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lensId: selectedLens }) }); window.location.reload(); } catch (error) { toast(error.message); } return; }
    const questionButton = target.closest('[data-question], [data-action="ask"]');
    if (questionButton) { const question = questionButton.getAttribute('data-question') || window.prompt('What would you like to understand about these lines?'); if (question && selectedText) await submitQuestion(question); return; }
    const action = target.closest('[data-action]')?.getAttribute('data-action');
    if (action === 'export') { downloadReview(); toast('Review exported as an HTML file.'); return; }
    if (action === 'copy-summary') { navigator.clipboard?.writeText(summaryPrompt()); toast('Summary prompt copied for Codex.'); return; }
    if (action === 'settings') { toast('Lens and zoom preferences are saved locally.'); }
  });

  byId('lens-select').addEventListener('change', (event) => { selectedLens = event.target.value; byId('lens-notice').hidden = false; });
  document.addEventListener('selectionchange', () => { const selection = window.getSelection(); const menu = byId('selection-menu'); if (!selection || selection.isCollapsed || !selection.anchorNode || !(selection.anchorNode.parentElement?.closest('.evidence'))) { menu.hidden = true; return; } selectedText = selection.toString().trim(); if (!selectedText) { menu.hidden = true; return; } const rect = selection.getRangeAt(0).getBoundingClientRect(); menu.style.left = Math.max(8, rect.left) + 'px'; menu.style.top = Math.max(8, rect.top - 42) + 'px'; menu.hidden = false; });
  async function submitQuestion(question) { byId('selection-menu').hidden = true; toast('Grounding an answer in the selected evidence…'); try { await api('/api/revision/' + state.revisionId + '/questions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selection: selectedText, question }) }); await loadQuestions(); toast('Added an evidence-grounded note.'); } catch (error) { toast(error.message); } }
  function openChapter(chapter, open) { if (!chapter) return; chapter.classList.toggle('open', open); chapter.querySelector('.chapter-detail').hidden = !open; chapter.querySelector('.chapter-toggle').setAttribute('aria-expanded', String(open)); }
  function downloadReview() { const blob = new Blob(['<!doctype html>\\n' + document.documentElement.outerHTML], { type: 'text/html' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = document.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.html'; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  function summaryPrompt() { const story = document.querySelector('#trailer')?.innerText?.trim() || document.querySelector('.main')?.innerText?.trim() || document.title; return 'Use this ndrstnd review summary to help me understand the implementation, decisions, risks, and tests.\\n\\n' + story; }
  async function loadLenses() { try { const lenses = await api('/api/lenses'); const select = byId('lens-select'); select.innerHTML = lenses.map((lens) => '<option value="' + escapeAttribute(lens.id) + '">' + escapeText(lens.name) + '</option>').join(''); select.value = lenses.some((lens) => lens.id === selectedLens) ? selectedLens : (lenses[0]?.id || 'default'); selectedLens = select.value; } catch (error) { toast('Could not load review lenses.'); } }
  async function loadQuestions() { try { const cards = await api('/api/revision/' + state.revisionId + '/questions'); const container = byId('question-cards'); container.className = ''; container.innerHTML = cards.length ? cards.map((card) => '<article class="question"><strong>' + escapeText(card.question) + '</strong><br>' + escapeText(card.answer || 'Thinking…') + '<small>' + provenance(card.provenance) + '</small></article>').join('') : 'No notes yet.'; } catch {} }
  const escapeText = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
  const escapeAttribute = escapeText;
  const provenance = (value) => value === 'general' ? 'General explanation; not repository-specific' : value === 'conversation' ? 'Based on supplied conversation' : value === 'both' ? 'Based on branch and conversation' : 'Based on branch and repository';
  loadLenses(); loadQuestions(); api('/api/preferences').then((preferences) => { const zoom = Number(preferences.zoom); const button = document.querySelector('[data-zoom="' + zoom + '"]'); if (button) button.click(); }).catch(() => {});
})();
`;

export const artifactClientScript = `
(() => {
  const byId = (id) => document.getElementById(id);
  const toast = (message) => { const node = byId('toast'); node.textContent = message; node.hidden = false; window.setTimeout(() => { node.hidden = true; }, 3600); };
  let selectedText = '';
  const currentStoryLevel = () => Number(document.body.dataset.storyLevel ?? 1);
  const setActiveView = (view, viewButton) => { document.querySelectorAll('[data-view]').forEach((node) => node.classList.toggle('active', node === viewButton)); document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === view)); const zoomControls = document.querySelector('.story-zoom-controls'); if (zoomControls) zoomControls.hidden = view !== 'trailer'; };
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const viewButton = target.closest('[data-view]');
    if (viewButton) { setActiveView(viewButton.getAttribute('data-view'), viewButton); return; }
    const chapterButton = target.closest('.chapter-toggle');
    if (chapterButton) { if (currentStoryLevel() <= 1) return; const chapter = chapterButton.closest('.chapter'); openChapter(chapter, !chapter.classList.contains('open')); return; }
    if (target.closest('[data-question], [data-action="ask"]')) { if (selectedText) { const prompt = (target.getAttribute('data-question') || 'Ask a question about') + "\\n\\nSelected ndrstnd evidence:\\n" + selectedText; navigator.clipboard?.writeText(prompt); toast('Prompt copied — paste it into Codex to continue.'); } return; }
    const action = target.closest('[data-action]')?.getAttribute('data-action');
    if (action === 'export') { downloadReview(); toast('Review exported as an HTML file.'); return; }
    if (action === 'copy-summary') { navigator.clipboard?.writeText(summaryPrompt()); toast('Summary prompt copied for Codex.'); return; }
    if (action === 'settings') toast('This portable artifact has no server-backed settings.');
  });
  document.addEventListener('selectionchange', () => { const selection = window.getSelection(); const menu = byId('selection-menu'); if (!selection || selection.isCollapsed || !selection.anchorNode || !(selection.anchorNode.parentElement?.closest('.evidence'))) { menu.hidden = true; return; } selectedText = selection.toString().trim(); if (!selectedText) { menu.hidden = true; return; } const rect = selection.getRangeAt(0).getBoundingClientRect(); menu.style.left = Math.max(8, rect.left) + 'px'; menu.style.top = Math.max(8, rect.top - 42) + 'px'; menu.hidden = false; });
  function openChapter(chapter, open) { if (!chapter) return; chapter.classList.toggle('open', open); chapter.querySelector('.chapter-detail').hidden = !open; chapter.querySelector('.chapter-toggle').setAttribute('aria-expanded', String(open)); }
  function downloadReview() { const blob = new Blob(['<!doctype html>\\n' + document.documentElement.outerHTML], { type: 'text/html' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = document.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.html'; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  function summaryPrompt() { const story = document.querySelector('#trailer')?.innerText?.trim() || document.querySelector('.main')?.innerText?.trim() || document.title; return 'Use this ndrstnd review summary to help me understand the implementation, decisions, risks, and tests.\\n\\n' + story; }
})();
`;

export const portableEnhancements = `
(() => {
  const byId = (id) => document.getElementById(id);
const levels = [{ name: 'Map', description: 'Themes and risk distribution' }, { name: 'Summary', description: 'Story claims and summaries' }, { name: 'Explanation', description: 'Before and after meaning' }, { name: 'Evidence', description: 'Focused code excerpts' }, { name: 'Raw', description: 'Complete change evidence' }]; const setChapterDetail = (chapter, expanded, animate) => { const detail = chapter.querySelector('.chapter-detail'); if (!detail) return; window.clearTimeout(Number(detail.dataset.zoomCollapseTimer)); if (expanded) { detail.hidden = false; if (animate) void detail.offsetHeight; chapter.classList.add('open'); detail.classList.toggle('zoom-revealed', animate); return; } chapter.classList.remove('open'); detail.classList.remove('zoom-revealed'); if (!animate) { detail.hidden = true; return; } detail.dataset.zoomCollapseTimer = String(window.setTimeout(() => { if (!chapter.classList.contains('open')) detail.hidden = true; }, 260)); }; const setZoom = (level) => { level = Math.max(0, Math.min(4, level)); const current = Number(document.body.dataset.storyLevel ?? 1); const changed = current !== level; const zoom = document.getElementById('zoom-control'); zoom?.classList.toggle('is-changing', changed); document.body.dataset.storyLevel = String(level); document.body.className = document.body.className.replace(/story-level-\\d/g, '') + ' story-level-' + level; document.querySelectorAll('[data-zoom]').forEach((button) => { const active = Number(button.dataset.zoom) === level; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); const label = document.getElementById('zoom-label'); label.textContent = levels[level].name; const description = document.getElementById('zoom-description'); if (description) description.textContent = levels[level].description; const callout = document.getElementById('zoom-callout'); if (callout) { callout.style.setProperty('--zoom-position', String(level / 4)); callout.dataset.edge = level === 0 ? 'start' : level === 4 ? 'end' : ''; } const map = document.getElementById('map'); if (map) map.hidden = level !== 0; document.querySelectorAll('.chapter').forEach((chapter) => setChapterDetail(chapter, level >= 2, changed)); if (changed) window.setTimeout(() => zoom?.classList.remove('is-changing'), 260); };
  setZoom(1);
  const setZoomControlsVisible = (view) => { const controls = document.querySelector('.story-zoom-controls'); if (controls) controls.hidden = view !== 'trailer'; };
  setZoomControlsVisible(document.querySelector('[data-view].active')?.getAttribute('data-view') || 'trailer');
  document.addEventListener('click', (event) => { const target = event.target instanceof Element ? event.target : null; if (!target) return; if (!target.closest('.selection-menu') && !target.closest('.evidence')) byId('selection-menu').hidden = true; const more = target.closest('.evidence-more'); if (more) { more.closest('.evidence')?.classList.toggle('expanded'); return; } const collapse = target.closest('.collapse-sidebar'); if (collapse) { document.querySelector('.sidebar')?.classList.toggle('collapsed'); return; } const all = target.closest('#collapse-all'); if (all) { document.querySelectorAll('.chapter').forEach((chapter) => { chapter.classList.remove('open'); chapter.querySelector('.chapter-detail').hidden = true; }); return; } const timeline = target.closest('[data-timeline-chapter]'); if (timeline) { const id = timeline.getAttribute('data-timeline-chapter'); document.querySelector('[data-view="trailer"]')?.click(); const chapter = document.querySelector('.chapter[data-chapter="' + id + '"]'); if (chapter) { chapter.classList.add('open'); chapter.querySelector('.chapter-detail').hidden = false; chapter.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; } const view = target.closest('[data-view]')?.getAttribute('data-view'); if (view) setZoomControlsVisible(view); const step = target.closest('[data-zoom-step]'); if (step) { const active = Number(document.querySelector('[data-zoom].active')?.getAttribute('data-zoom') ?? 1); setZoom(active + Number(step.getAttribute('data-zoom-step'))); return; } if (target.closest('.zoom-info')) { document.getElementById('zoom-dialog').showModal(); return; } if (target.closest('[data-close-dialog]')) { document.getElementById('zoom-dialog').close(); return; } const zoom = target.closest('[data-zoom]'); if (zoom) setZoom(Number(zoom.getAttribute('data-zoom'))); });
})();
(() => {
  const shell = document.querySelector('.app-shell');
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('.collapse-sidebar')) {
      const collapsed = document.querySelector('.sidebar')?.classList.contains('collapsed') ?? false;
      shell?.classList.toggle('sidebar-collapsed', collapsed);
      target.closest('.collapse-sidebar')?.setAttribute('aria-expanded', String(!collapsed));
      return;
    }
    const mobileInspector = target.closest('.mobile-inspector-toggle');
    if (mobileInspector) {
      const open = shell?.classList.toggle('mobile-inspector-open') ?? false;
      mobileInspector.setAttribute('aria-expanded', String(open));
      return;
    }
    const inspectorToggle = target.closest('.collapse-inspector');
    if (!inspectorToggle) return;
    if (window.innerWidth <= 760) {
      shell?.classList.remove('mobile-inspector-open');
      document.querySelector('.mobile-inspector-toggle')?.setAttribute('aria-expanded', 'false');
      return;
    }
    const collapsed = shell?.classList.toggle('inspector-collapsed') ?? false;
    inspectorToggle.setAttribute('aria-expanded', String(!collapsed));
  });
})();
(() => {
  const preferenceKey = 'ndrstnd-artifact-ui-preferences-v1';
  const readPreferences = () => {
    try {
      const value = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  };
  const savePreferences = (update) => {
    try { localStorage.setItem(preferenceKey, JSON.stringify({ ...readPreferences(), ...update })); } catch {}
  };
  const preferences = readPreferences();
  const shell = document.querySelector('.app-shell');
  const sidebar = document.querySelector('.sidebar');
  if (typeof preferences.sidebarCollapsed === 'boolean') {
    sidebar?.classList.toggle('collapsed', preferences.sidebarCollapsed);
    shell?.classList.toggle('sidebar-collapsed', preferences.sidebarCollapsed);
    document.querySelector('.collapse-sidebar')?.setAttribute('aria-expanded', String(!preferences.sidebarCollapsed));
  }
  if (typeof preferences.inspectorCollapsed === 'boolean') {
    shell?.classList.toggle('inspector-collapsed', preferences.inspectorCollapsed);
    document.querySelector('.collapse-inspector')?.setAttribute('aria-expanded', String(!preferences.inspectorCollapsed));
  }
  if (Number.isInteger(preferences.zoom) && preferences.zoom >= 0 && preferences.zoom <= 4) document.querySelector('[data-zoom="' + preferences.zoom + '"]')?.click();
  if (typeof preferences.view === 'string') document.querySelector('[data-view="' + preferences.view + '"]')?.click();
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const view = target.closest('[data-view]')?.getAttribute('data-view');
    if (view) savePreferences({ view });
    const zoom = target.closest('[data-zoom]')?.getAttribute('data-zoom');
    if (zoom !== null && zoom !== undefined) savePreferences({ zoom: Number(zoom) });
    if (target.closest('.collapse-sidebar')) savePreferences({ sidebarCollapsed: document.querySelector('.sidebar')?.classList.contains('collapsed') ?? false });
    if (target.closest('.collapse-inspector') && window.innerWidth > 760) savePreferences({ inspectorCollapsed: shell?.classList.contains('inspector-collapsed') ?? false });
  });
})();
(() => { const positionCallout = () => { const callout = document.getElementById('zoom-callout'); if (!callout || window.innerWidth > 760) return; callout.style.setProperty('--edge-offset', '0px', 'important'); callout.style.setProperty('--pointer-offset', '50%'); window.clearTimeout(Number(callout.dataset.calloutClampTimer)); callout.dataset.calloutClampTimer = String(window.setTimeout(() => { const rect = callout.getBoundingClientRect(); const offset = rect.left < 12 ? 12 - rect.left : rect.right > window.innerWidth - 12 ? window.innerWidth - 12 - rect.right : 0; callout.style.setProperty('--edge-offset', offset + 'px', 'important'); callout.style.setProperty('--pointer-offset', 'calc(50% - ' + offset + 'px)'); }, 280)); }; positionCallout(); document.addEventListener('click', (event) => { const target = event.target instanceof Element ? event.target : null; if (target?.closest('[data-zoom],[data-zoom-step]')) positionCallout(); }); window.addEventListener('resize', positionCallout); })();
`;
