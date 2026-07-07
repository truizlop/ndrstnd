import type { AnalysisDocument } from "../shared/analysis-schema.js";
import type { ChangedFile, DiffHunk, DiffLine } from "../shared/domain.js";
import type { ReviewPresentationData } from "./review-data.js";
import { attentionCounts, categoryCounts, chapterMetrics, focusLinesFromRanges, focusedEvidenceLines, isSupportingFile, linePrefix, toUnifiedDiff } from "./evidence-model.js";
import { resolveLanguage, syntaxHighlighter } from "./language.js";
import { buildTestThemes, deriveTestSummary, focusedTestLines, isTestPath, testTypeLabel, type TestThemeModel } from "./test-plan-model.js";
import { parse as parseDiff } from "diff2html";
import type { DiffBlock, DiffLine as ParsedDiffLine } from "diff2html/lib/types.js";
import type { BundledLanguage, Highlighter } from "shiki";

function panelIcon(kind: "collapse-left" | "collapse-right" | "details"): string {
  const paths: Record<typeof kind, string> = {
    "collapse-left": '<path d="M9.8 3.8L5.6 8l4.2 4.2"/>',
    "collapse-right": '<path d="M6.2 3.8L10.4 8l-4.2 4.2"/>',
    details: '<rect x="2.2" y="3" width="11.6" height="10" rx="2"/><path d="M9.8 3v10"/>',
  };
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${paths[kind]}</svg>`;
}

function actionIcon(kind: "export" | "copy"): string {
  const paths: Record<typeof kind, string> = {
    export: '<path d="M8 9.8V2.6M5.2 5.2L8 2.4l2.8 2.8"/><path d="M2.8 9.6v2.6a1.2 1.2 0 0 0 1.2 1.2h8a1.2 1.2 0 0 0 1.2-1.2V9.6"/>',
    copy: '<rect x="5.4" y="5.4" width="7.8" height="8.6" rx="1.6"/><path d="M2.8 10.6V4.2a1.4 1.4 0 0 1 1.4-1.4h5.4"/>',
  };
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${paths[kind]}</svg>`;
}

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
  // The body is rendered before the head so the token-class table collects
  // every syntax color pair the page uses before it is emitted as CSS.
  const body = `<body><div class="app-shell">
  <aside class="sidebar"><div class="brand"><svg class="brand-mark" viewBox="0 0 20 22" aria-hidden="true"><path d="M4.4 3.4 10 7.6l5.6-4.2"/><path d="M4.4 8.9 10 13.1l5.6-4.2"/><path class="mark-deep" d="M4.4 14.4 10 18.6l5.6-4.2"/></svg><span class="brand-name">ndrstnd</span><button class="collapse-sidebar panel-toggle" aria-label="Collapse navigation" aria-expanded="true">${panelIcon("collapse-left")}</button><button class="mobile-inspector-toggle panel-toggle" aria-label="Show review details" aria-expanded="false">${panelIcon("details")}</button></div><nav aria-label="Review views"><button class="nav-item active" data-view="trailer">${navIcon("story")}Story</button><button class="nav-item" data-view="timeline">${navIcon("timeline")}Timeline</button>${data.document.chapters.some((chapter) => chapter.kind === "test") ? `<button class="nav-item" data-view="tests">${navIcon("tests")}Test plan</button>` : ""}<button class="nav-item" data-view="diff">${navIcon("diff")}Full diff</button></nav></aside>
  <main class="main"><header class="page-header"><div class="masthead"><p class="masthead-overline">Change review</p><h1>${escapeHtml(data.targetRef)}</h1><div class="breadcrumbs"><span>against <strong>${escapeHtml(data.baseRef)}</strong></span><span>merge base <code>${escapeHtml(data.mergeBase.slice(0, 8))}</code></span></div></div></header><div class="view-bar"><span class="view-bar-ref">${escapeHtml(data.targetRef)}</span>${artifact ? "" : `<label class="lens-label">Lens <select id="lens-select" aria-label="Review lens"><option>Loading…</option></select></label>`}<div class="story-zoom-controls"><button data-zoom-step="-1" aria-label="Decrease detail">−</button><div class="zoom" id="zoom-control" role="group" aria-label="Story detail level"><div class="zoom-callout" id="zoom-callout" aria-live="polite"><output id="zoom-label">Summary</output><span id="zoom-description">Story claims and summaries</span></div><button data-zoom="0" aria-label="Map" title="Map"></button><button data-zoom="1" aria-label="Summary" title="Summary" class="active"></button><button data-zoom="2" aria-label="Explanation" title="Explanation"></button><button data-zoom="3" aria-label="Evidence" title="Evidence"></button><button data-zoom="4" aria-label="Raw" title="Raw"></button></div><button data-zoom-step="1" aria-label="Increase detail">+</button></div></div>
  ${artifact ? "" : `<div id="lens-notice" class="notice" hidden><span>Review lens changed. Grouping and risk signals will change.</span><button id="rerun">Re-run analysis</button></div>`}
  <section id="trailer" class="view active"><p class="review-summary">${escapeHtml(data.document.summary)}</p><p class="coverage">${data.files.length} files · ${data.hunks.length} evidence hunks · ${data.document.chapters.length} story chapters · ${data.document.steps.length} build steps</p><div class="story-toolbar"><div id="map" class="map" hidden>${Object.entries(counts).map(([key, value]) => `<div><span class="dot ${key}"></span>${escapeHtml(key)} <strong>${value}</strong></div>`).join("")}</div><button id="collapse-all">Collapse all</button></div><div class="chapter-list">${renderChapters(data.document, data.hunks, filePaths, data.files, highlighter)}</div>${renderOtherFilesChanged(data.files, data.hunks)}${renderOmitted(data.document, data.hunks)}</section>
  <section id="timeline" class="view"><p class="section-title">Build path</p><p class="view-subtitle">A constructive reconstruction of how you would assemble this change so each step builds on what came before.</p>${renderTimeline(data.document, data.hunks, filePaths, data.files, highlighter)}</section>
  <section id="diff" class="view"><p class="section-title">Every patch hunk</p>${data.files.map((file) => renderFullDiff(file, data.hunks.filter((hunk) => hunk.fileId === file.id), highlighter)).join("")}</section>
  <section id="tests" class="view"><p class="section-title">Test plan</p><p class="test-plan-subtitle">See how the changed behavior was exercised, from high-level themes to raw test evidence.</p>${renderTestPlan(data.document, data.hunks, filePaths, data.files, highlighter)}</section>
  <footer class="colophon"><svg viewBox="0 0 20 22" aria-hidden="true"><path d="M4.4 3.4 10 7.6l5.6-4.2"/><path d="M4.4 8.9 10 13.1l5.6-4.2"/><path class="mark-deep" d="M4.4 14.4 10 18.6l5.6-4.2"/></svg><span>ndrstnd · created by Tomás Ruiz-López</span></footer>
  </main>
  <aside class="inspector" aria-label="Review details"><header class="inspector-header"><h2>At a glance</h2><button class="collapse-inspector panel-toggle" aria-label="Collapse review details" aria-expanded="true">${panelIcon("collapse-right")}</button></header><div class="inspector-content"><section><h3>This change</h3><div class="stat-row"><span>Story chapters</span><strong>${data.document.chapters.length}</strong></div><div class="stat-row"><span>Build steps</span><strong>${data.document.steps.length}</strong></div><div class="stat-row"><span>Changed files</span><strong>${data.files.length}</strong></div><div class="stat-row"><span>Evidence hunks</span><strong>${data.hunks.length}</strong></div></section><section><h3>Focus areas</h3>${Object.entries(categoryCounts(data.document)).map(([category, count]) => `<div class="stat-row stat-category"><span>${categoryIcon(category)}${escapeHtml(category)}</span><strong>${count}</strong></div>`).join("")}</section><section><h3>Actions</h3><button class="inspector-action" data-action="export">${actionIcon("export")}Export review…</button><button class="inspector-action" data-action="copy-summary" title="Copy a concise prompt for asking Codex about this review">${actionIcon("copy")}Copy Codex prompt</button></section></div></aside>
</div>${renderEvidenceLibrary(data, filePaths, highlighter)}<div id="selection-menu" class="selection-menu" hidden><button data-question="Explain the selected lines.">Explain selection</button><button data-question="Trace the callers, effects, and dependencies of the selected lines.">Trace effects</button><button data-question="Why is this included in the change?">Why included?</button><button data-action="ask">Ask a question…</button></div><div id="toast" class="toast" hidden></div><script>${artifact ? artifactClientScript : `const ndrstnd=${state};${clientScript}`}${portableEnhancements}</script></body></html>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ndrstnd · ${escapeHtml(data.targetRef)}</title><style>${styles}${tokenStyleRules()}</style></head>
${body}`;
}

/**
 * Every hunk referenced by a step or a chapter is rendered exactly once here;
 * timeline states and chapter details clone from these templates at runtime
 * instead of shipping their own copies, which kept multi-step artifacts at
 * tens of megabytes.
 */
function renderEvidenceLibrary(data: ReviewPresentationData, filePaths: Map<string, string>, highlighter: Highlighter): string {
  const filesById = new Map(data.files.map((file) => [file.id, file]));
  const stepIndexByEvidence = new Map<string, number | undefined>();
  for (const [index, step] of data.document.steps.entries()) for (const id of step.evidenceIds) stepIndexByEvidence.set(id, index);
  for (const chapter of data.document.chapters) {
    for (const id of chapter.evidenceIds) {
      const hunk = data.hunks.find((candidate) => candidate.id === id);
      if (hunk === undefined || isSupportingFile(filesById.get(hunk.fileId))) continue;
      if (!stepIndexByEvidence.has(id)) stepIndexByEvidence.set(id, undefined);
    }
  }
  if (stepIndexByEvidence.size === 0) return "";
  const templates = [...stepIndexByEvidence.entries()].map(([id, stepIndex]) => {
    const hunk = requireHunk(data.hunks, id);
    return `<template data-evidence-template="${escapeHtml(id)}">${renderEvidence(hunk, filePaths.get(hunk.fileId) ?? hunk.fileId, highlighter, stepIndex, data.document.focus?.[id])}</template>`;
  }).join("");
  return `<div id="evidence-library" hidden>${templates}</div>`;
}

function renderChapters(document: AnalysisDocument, hunks: DiffHunk[], filePaths: Map<string, string>, files: ChangedFile[], highlighter: Highlighter): string {
  const filesById = new Map(files.map((file) => [file.id, file]));
  const stepsByChapter = new Map<string, Array<{ id: string; index: number }>>();
  const stepIndexByEvidence = new Map<string, number>();
  for (const [index, step] of document.steps.entries()) {
    for (const chapterId of step.advancesChapterIds) {
      const list = stepsByChapter.get(chapterId) ?? [];
      list.push({ id: step.id, index });
      stepsByChapter.set(chapterId, list);
    }
    for (const evidenceId of step.evidenceIds) stepIndexByEvidence.set(evidenceId, index);
  }
  return document.chapters.map((chapter, index) => {
    const metrics = chapterMetrics(chapter, hunks);
    const stepChips = (stepsByChapter.get(chapter.id) ?? []).map((step) => `<span class="step-chip" role="button" tabindex="0" data-story-step="${escapeHtml(step.id)}">step ${String(step.index + 1).padStart(2, "0")}</span>`).join("");
    const evidenceIds = chapter.evidenceIds
      .map((id) => requireHunk(hunks, id))
      .filter((hunk) => !isSupportingFile(filesById.get(hunk.fileId)))
      .map((hunk) => hunk.id);
    return `<article class="chapter" data-chapter="${escapeHtml(chapter.id)}"><button class="chapter-toggle" aria-expanded="false"><span class="chapter-number attention-${escapeHtml(chapter.attention)}">${String(index + 1).padStart(2, "0")}</span><span class="chapter-copy"><strong>${escapeHtml(chapter.title)}</strong><small>${escapeHtml(chapter.synopsis)}</small>${stepChips ? `<span class="chapter-steps">${stepChips}</span>` : ""}<span class="chapter-tags">${chapter.riskCategories.map((risk) => `<span class="chapter-tag">${categoryIcon(risk)}${escapeHtml(risk)}</span>`).join("")}</span>${renderChapterMapMetrics(metrics)}</span><span class="chevron" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 4.25L6 7.75l3.5-3.5"/></svg></span></button><div class="chapter-detail" hidden>${renderSemantic(chapter.before, chapter.after)}${evidenceIds.length > 0 ? `<div class="evidence-stack" data-evidence-list="${escapeHtml(evidenceIds.join(" "))}"></div>` : ""}</div></article>`;
  }).join("");
}

const ATTENTION_RANK = { low: 0, contained: 1, elevated: 2, high: 3, critical: 4 } as const;

function renderTimeline(document: AnalysisDocument, hunks: DiffHunk[], filePaths: Map<string, string>, files: ChangedFile[], highlighter: Highlighter): string {
  const chaptersById = new Map(document.chapters.map((chapter) => [chapter.id, chapter]));
  if (document.steps.length === 0) return `<p class="empty-note">This change has no meaningful evidence to reconstruct as a build path.</p>`;
  const ordinal = (index: number) => String(index + 1).padStart(2, "0");
  const attentionFor = (step: AnalysisDocument["steps"][number]) => step.advancesChapterIds
    .map((chapterId) => chaptersById.get(chapterId)?.attention ?? "low")
    .reduce((highest, attention) => (ATTENTION_RANK[attention] > ATTENTION_RANK[highest] ? attention : highest), "low" as keyof typeof ATTENTION_RANK);
  const stepIndexByEvidence = new Map<string, number>();
  for (const [index, step] of document.steps.entries()) for (const evidenceId of step.evidenceIds) stepIndexByEvidence.set(evidenceId, index);
  const stepOrdinalById = new Map(document.steps.map((step, stepIndex) => [step.id, ordinal(stepIndex)]));
  const stepLabel = (id: string) => (stepOrdinalById.has(id) ? `step ${stepOrdinalById.get(id)}` : id);

  const ticks = document.steps.map((step, index) => `<button class="rail-tick attention-${escapeHtml(attentionFor(step))}${index === 0 ? " active" : ""}" role="tab" aria-selected="${index === 0 ? "true" : "false"}" data-timeline-select="${escapeHtml(step.id)}" data-step-title="${escapeHtml(step.title)}" title="${ordinal(index)} · ${escapeHtml(step.title)}"></button>`).join("");
  const rail = `<div class="timeline-rail"><button class="rail-nav" data-timeline-move="-1" aria-label="Previous step" disabled>${railIcon("previous")}</button><div class="rail-ticks" role="tablist" aria-label="Build steps">${ticks}</div><button class="rail-nav" data-timeline-move="1" aria-label="Next step"${document.steps.length === 1 ? " disabled" : ""}>${railIcon("next")}</button><p class="rail-readout"><output id="rail-step" aria-live="polite">01 / ${String(document.steps.length).padStart(2, "0")}</output><span id="rail-title">${escapeHtml(document.steps[0].title)}</span></p></div>`;
  const plan = `<div class="timeline-plan">${document.steps.map((step, index) => `<button class="timeline-plan-step attention-${escapeHtml(attentionFor(step))}" data-timeline-select="${escapeHtml(step.id)}"><span>${ordinal(index)}</span><div><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.goal)}</p></div></button>`).join("")}</div>`;

  const states = document.steps.map((step, index) => {
    const priorEvidence = document.steps.slice(0, index).flatMap((candidate) => candidate.evidenceIds);
    const churn = churnFor(step.evidenceIds.map((id) => requireHunk(hunks, id)));
    const filesTouched = [...churn.entries()].map(([fileId, counts]) => `<span class="timeline-file"><span>${escapeHtml(filePaths.get(fileId) ?? fileId)}</span><small><b class="additions">+${counts.additions}</b><b class="deletions">−${counts.deletions}</b></small></span>`).join("");
    const chapters = step.advancesChapterIds.map((chapterId) => chaptersById.get(chapterId)).filter((chapter): chapter is NonNullable<typeof chapter> => chapter !== undefined);
    const chapterLinks = chapters.map((chapter) => `<button data-step-chapter="${escapeHtml(chapter.id)}">Story · ${escapeHtml(chapter.title)}</button>`).join("");
    const deferred = step.deferred.length === 0 ? `<p class="empty-note">Nothing was postponed at this step.</p>` : `<ul>${step.deferred.map((item) => `<li>${escapeHtml(item.concern)}${item.resolvedByStepId ? ` <button data-timeline-select="${escapeHtml(item.resolvedByStepId)}">${escapeHtml(stepLabel(item.resolvedByStepId))}</button>` : ""}</li>`).join("")}</ul>`;
    const forwardRefs = Object.entries(step.forwardRefs);
    const refs = forwardRefs.length === 0 ? `<p class="empty-note">Every symbol used here already exists.</p>` : `<ul>${forwardRefs.map(([symbol, targetStepId]) => `<li><code>${escapeHtml(symbol)}</code> is introduced at <button data-timeline-select="${escapeHtml(targetStepId)}">${escapeHtml(stepLabel(targetStepId))}</button></li>`).join("")}</ul>`;
    const buildsOn = step.dependsOn.filter((id) => stepOrdinalById.has(id)).map((id) => `<button data-timeline-select="${escapeHtml(id)}">Builds on · ${escapeHtml(stepLabel(id))}</button>`).join("");
    return `<article class="timeline-state${index === 0 ? " active" : ""}" data-timeline-state="${escapeHtml(step.id)}" data-step-index="${index + 1}"${index === 0 ? "" : " hidden"}><header class="timeline-card"><span class="timeline-index attention-${escapeHtml(attentionFor(step))}">${ordinal(index)}</span><div><h2>${escapeHtml(step.title)}</h2><p class="timeline-goal">${escapeHtml(step.goal)}</p>${filesTouched ? `<div class="timeline-files">${filesTouched}</div>` : ""}${chapterLinks || buildsOn ? `<div class="timeline-chapter-links">${chapterLinks}${buildsOn}</div>` : ""}</div></header><div class="timeline-summary"><strong>You now have</strong><p>${escapeHtml(step.youNowHave)}</p></div><div class="timeline-explanation"><section><h3>Deferred for later steps</h3>${deferred}</section><section><h3>Forward references</h3>${refs}</section></div><div class="timeline-evidence" data-current-evidence="${escapeHtml(step.evidenceIds.join(" "))}" data-prior-evidence="${escapeHtml(priorEvidence.join(" "))}"></div><div class="timeline-raw"></div></article>`;
  }).join("");
  return `<div class="timeline">${rail}${plan}<div class="timeline-states">${states}</div></div>`;
}

function churnFor(hunks: DiffHunk[]): Map<string, { additions: number; deletions: number }> {
  const churnByFile = new Map<string, { additions: number; deletions: number }>();
  for (const hunk of hunks) {
    const churn = churnByFile.get(hunk.fileId) ?? { additions: 0, deletions: 0 };
    for (const line of hunk.lines) {
      if (line.kind === "addition") churn.additions += 1;
      if (line.kind === "deletion") churn.deletions += 1;
    }
    churnByFile.set(hunk.fileId, churn);
  }
  return churnByFile;
}

function renderChapterMapMetrics(metrics: ReturnType<typeof chapterMetrics>): string {
  const files = `${metrics.files} file${metrics.files === 1 ? "" : "s"}`;
  const hunks = `${metrics.hunks} hunk${metrics.hunks === 1 ? "" : "s"}`;
  const additions = `${metrics.additions} addition${metrics.additions === 1 ? "" : "s"}`;
  const deletions = `${metrics.deletions} deletion${metrics.deletions === 1 ? "" : "s"}`;
  return `<span class="chapter-map-meta" aria-label="${additions}, ${deletions}, ${files}, ${hunks}"><span class="chapter-churn"><b class="additions">+${metrics.additions}</b><b class="deletions">−${metrics.deletions}</b></span><span>${files}</span><span>${hunks}</span></span><span class="chapter-churn-bar" aria-hidden="true" style="--add:${metrics.addShare};--delete:${metrics.deleteShare}"><i class="additions"></i><i class="deletions"></i></span>`;
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

function railIcon(direction: "previous" | "next"): string {
  const paths: Record<typeof direction, string> = {
    previous: '<path d="M9.8 3.8L5.6 8l4.2 4.2"/>',
    next: '<path d="M6.2 3.8L10.4 8l-4.2 4.2"/>',
  };
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${paths[direction]}</svg>`;
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

function renderEvidence(hunk: DiffHunk, path: string, highlighter: Highlighter, stepIndex?: number, focus?: Array<{ start: number; end: number }>): string {
  const focused = focusLinesFromRanges(hunk.lines, focus) ?? focusedEvidenceLines(hunk.lines);
  if (focused.length === 0) return "";
  const language = resolveLanguage(path);
  let previousIndex = -1;
  const excerpt = focused.map(({ line, index }) => {
    const omission = previousIndex >= 0 && index > previousIndex + 1 ? renderOmission() : "";
    previousIndex = index;
    return `${omission}${renderEvidenceLine(line, language, highlighter)}`;
  }).join("");
  const omittedCount = hunk.lines.length - focused.length;
  const tag = stepIndex === undefined ? "" : `<button class="evidence-step-tag" data-story-step-index="${stepIndex + 1}">step ${String(stepIndex + 1).padStart(2, "0")}</button>`;
  // The raw variant is cloned at runtime from the matching Full diff block, so
  // every hunk body ships exactly once in the artifact.
  return `<article class="evidence focused-evidence" data-evidence-id="${escapeHtml(hunk.id)}"><header><span class="evidence-path">${escapeHtml(path)}</span><span class="focused-label">Focused excerpt · @@ −${hunk.oldStart} +${hunk.newStart} @@</span><span class="raw-label">Complete excerpt · @@ −${hunk.oldStart} +${hunk.newStart} @@</span>${tag}</header><pre class="focused-code">${excerpt}</pre>${omittedCount > 0 ? `<p class="evidence-context">${omittedCount} routine line${omittedCount === 1 ? "" : "s"} omitted</p>` : ""}</article>`;
}

function renderEvidenceLine(line: DiffLine, language: BundledLanguage, highlighter: Highlighter): string {
  return `<span class="line ${line.kind}"><b>${line.oldLine ?? ""}</b><b>${line.newLine ?? ""}</b><code><span class="diff-prefix">${linePrefix(line.kind)}</span>${highlightCode(line.content, language, highlighter)}</code></span>`;
}

function renderOmission(): string {
  return `<span class="line omission" aria-label="Routine lines omitted"><span class="omission-divider"><i></i><b>⌁</b><i></i></span></span>`;
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
  return `<details class="file full-diff-file" open data-file-id="${escapeHtml(file.id)}"><summary><span class="file-path">${escapeHtml(file.path)}</span><small>${escapeHtml(file.signalReason ?? file.status)}</small></summary>${parsed.blocks.map((block, index) => renderDiffBlock(block, language, highlighter, hunks[index]?.id)).join("")}</details>`;
}

function renderDiffBlock(block: DiffBlock, language: BundledLanguage, highlighter: Highlighter, hunkId?: string): string {
  const tokenLines = highlighter.codeToTokens(block.lines.map((line) => line.content.slice(1)).join("\n"), { lang: language, themes: syntaxThemes }).tokens;
  return `<div class="diff-block"${hunkId === undefined ? "" : ` data-diff-hunk="${escapeHtml(hunkId)}"`}><div class="diff-hunk-header">${escapeHtml(block.header)}</div><pre>${block.lines.map((line, index) => renderDiffLine(line, tokenLines[index] ?? [])).join("")}</pre></div>`;
}

function renderDiffLine(line: ParsedDiffLine, tokens: Array<{ content: string; color?: string; fontStyle?: number }>): string {
  const kind = line.type === "insert" ? "addition" : line.type === "delete" ? "deletion" : "context";
  return `<span class="line ${kind}"><b>${line.oldNumber ?? ""}</b><b>${line.newNumber ?? ""}</b><code><span class="diff-prefix">${escapeHtml(line.content.slice(0, 1))}</span>${renderTokens(tokens)}</code></span>`;
}

/** Both themes are emitted per token; dark mode flips to the --shiki-dark variable. */
const syntaxThemes = { light: "github-light", dark: "github-dark" } as const;

function highlightCode(source: string, language: BundledLanguage, highlighter: Highlighter): string {
  return renderTokens(highlighter.codeToTokens(source, { lang: language, themes: syntaxThemes }).tokens[0] ?? []);
}

/**
 * Syntax colors repeat constantly, so each distinct color pair becomes one CSS
 * class instead of ~90 bytes of inline styles per token. The registry is
 * append-only and process-wide; every rendered page emits the full table.
 */
const tokenClassRegistry = new Map<string, string>();

function tokenClass(style: string): string {
  let name = tokenClassRegistry.get(style);
  if (name === undefined) {
    name = `c${tokenClassRegistry.size}`;
    tokenClassRegistry.set(style, name);
  }
  return name;
}

function tokenStyleRules(): string {
  return [...tokenClassRegistry].map(([style, name]) => `.${name}{${style}}`).join("");
}

function renderTokens(tokens: Array<{ content: string; color?: string; fontStyle?: number; htmlStyle?: Record<string, string> }>): string {
  return tokens.map((token) => {
    const style = token.htmlStyle === undefined
      ? (token.color === undefined ? "" : `color:${token.color}`)
      : Object.entries(token.htmlStyle).map(([property, value]) => `${property}:${value}`).join(";");
    const classes = [style === "" ? "" : `tk ${tokenClass(style)}`, token.fontStyle === 1 ? "token-italic" : ""].filter(Boolean).join(" ");
    return `<span${classes === "" ? "" : ` class="${classes}"`}>${escapeHtml(token.content)}</span>`;
  }).join("");
}

function renderOmitted(document: AnalysisDocument, hunks: DiffHunk[]): string {
  const count = document.omittedGroups.reduce((sum, group) => sum + group.evidenceIds.length, 0);
  const unclassified = document.unclassifiedEvidenceIds.length;
  if (count + unclassified === 0) return "";
  const summary = unclassified === 0 ? `${count} low-signal hunks collapsed` : count === 0 ? `${unclassified} unclassified hunks collapsed` : `${count + unclassified} low-signal or unclassified hunks collapsed`;
  const groups = [
    ...document.omittedGroups.map((group) => `<p><strong>${escapeHtml(group.title)}</strong> · ${escapeHtml(group.reason)}</p>`),
    ...(unclassified > 0 ? [`<p><strong>Unclassified evidence</strong> · ${unclassified} hunk${unclassified === 1 ? "" : "s"} the analysis could not attach to a story chapter; see Full diff.</p>`] : []),
  ];
  return `<details class="omitted"><summary>${summary}</summary>${groups.join("")}</details>`;
}

function renderTestPlan(document: AnalysisDocument, hunks: DiffHunk[], filePaths: Map<string, string>, files: ChangedFile[], highlighter: Highlighter): string {
  const themes = buildTestThemes(document, hunks, filePaths);
  const cases = themes.flatMap((theme) => theme.cases);
  const testFiles = [...new Set(cases.map((testCase) => testCase.filePath))];
  const changedTestFiles = files.filter((file) => isTestPath(file.path));
  if (cases.length === 0 && changedTestFiles.length === 0) return `<p class="empty-note">No test activity was captured for this change.</p>`;
  const runs = document.testExecution ?? [];
  const summary = [
    `${cases.length} tested behavior${cases.length === 1 ? "" : "s"}`,
    `${new Set([...testFiles, ...changedTestFiles.map((file) => file.path)]).size} test file${new Set([...testFiles, ...changedTestFiles.map((file) => file.path)]).size === 1 ? "" : "s"}`,
    `${runs.length} observed test run${runs.length === 1 ? "" : "s"}`,
    runs.length === 0 ? "Run result not observed" : `Observed result: ${aggregateRunOutcome(runs)}`,
  ].map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  return `<div class="test-plan-summary">${summary}</div><div class="test-plan-level test-plan-map">${renderTestPlanMap(themes)}</div><div class="test-plan-level test-plan-summary-level">${renderTestPlanSummary(themes)}</div><div class="test-plan-level test-plan-explanation">${renderTestPlanExplanation(themes)}</div><div class="test-plan-level test-plan-evidence">${renderTestPlanEvidence(themes, highlighter, runs)}</div><div class="test-plan-level test-plan-raw">${renderTestPlanRaw(themes, highlighter, runs)}</div>`;
}

type TestExecutionRun = NonNullable<AnalysisDocument["testExecution"]>[number];

function aggregateRunOutcome(runs: TestExecutionRun[]): TestExecutionRun["outcome"] {
  if (runs.some((run) => run.outcome === "failed")) return "failed";
  if (runs.length > 0 && runs.every((run) => run.outcome === "passed")) return "passed";
  if (runs.some((run) => run.outcome === "mixed" || run.outcome === "passed")) return "mixed";
  return "unknown";
}

function renderTestPlanMap(themes: TestThemeModel[]): string {
  const derivedSummary = deriveTestSummary(themes);
  return `${derivedSummary ? `<p class="test-generated-summary">${escapeHtml(derivedSummary)}</p>` : ""}<div class="test-theme-grid">${themes.map((theme) => `<article class="test-theme-card" data-test-theme="${escapeHtml(theme.id)}"><h2>${escapeHtml(theme.title)}</h2><p>${escapeHtml(theme.synopsis)}</p><div class="test-theme-meta"><span>${theme.cases.length} tested behavior${theme.cases.length === 1 ? "" : "s"}</span><span>${testTypeLabel(theme.cases)}</span>${theme.storyClaims.length > 0 ? `<span>${theme.storyClaims.length} story claim${theme.storyClaims.length === 1 ? "" : "s"}</span>` : ""}</div>${theme.cases.length === 0 ? `<p class="empty-note">No associated test evidence</p>` : ""}</article>`).join("")}</div>`;
}

function renderTestPlanSummary(themes: TestThemeModel[]): string {
  return themes.map((theme) => `<section class="test-behavior-group"><h2>${escapeHtml(theme.title)}</h2>${theme.cases.length === 0 ? `<p class="empty-note">No associated test evidence</p>` : theme.cases.map((testCase) => `<article class="test-behavior" data-test-case="${escapeHtml(testCase.id)}"><button data-test-jump="${escapeHtml(testCase.id)}"><strong>${escapeHtml(testCase.name)}</strong><span>${escapeHtml(testCase.chapter.synopsis)}</span></button><div class="test-inline-meta"><span>${escapeHtml(testCase.filePath)}</span><span>${testTypeLabel([testCase])}</span><span>Test implementation found</span></div></article>`).join("")}</section>`).join("");
}

function renderTestPlanExplanation(themes: TestThemeModel[]): string {
  return themes.map((theme) => `<section class="test-explanation-group"><h2>${escapeHtml(theme.title)}</h2>${theme.cases.length === 0 ? `<p class="empty-note">No associated test evidence</p>` : theme.cases.map((testCase) => `<article class="test-explanation-card" data-test-case="${escapeHtml(testCase.id)}"><h3>${escapeHtml(testCase.name)}</h3><p class="test-what">${escapeHtml(testCase.chapter.synopsis)}</p>${renderSemantic(testCase.chapter.before, testCase.chapter.after)}<div class="test-refs"><span class="test-ref-file">${escapeHtml(testCase.filePath)}</span>${theme.storyClaims[0] && theme.storyClaims[0].title !== theme.title ? `<span class="test-ref-claim">Story · ${escapeHtml(theme.storyClaims[0].title)}</span>` : ""}</div></article>`).join("")}</section>`).join("");
}

function renderTestPlanEvidence(themes: TestThemeModel[], highlighter: Highlighter, runs: TestExecutionRun[]): string {
  const execution = runs.length === 0 ? "Execution evidence not observed" : `${runs[0].command}${runs.length > 1 ? ` and ${runs.length - 1} more run${runs.length === 2 ? "" : "s"}` : ""}`;
  const result = runs.length === 0 ? "Not observed" : `Suite ${aggregateRunOutcome(runs)}`;
  return themes.map((theme) => theme.cases.length === 0 ? `<article class="test-evidence-card"><h2>${escapeHtml(theme.title)}</h2><p class="empty-note">No associated test evidence</p></article>` : theme.cases.map((testCase) => `<details class="test-evidence-card" data-test-case="${escapeHtml(testCase.id)}"><summary><span><strong>${escapeHtml(testCase.name)}</strong><small>${escapeHtml(testCase.filePath)}</small></span><span class="test-state">Test implementation found</span></summary>${renderTestExcerpt(testCase.hunk, testCase.filePath, highlighter, false)}<div class="test-evidence-meta"><div><strong>Associated implementation</strong><span>Source mapping unavailable</span></div><div><strong>Observed execution</strong><span>${escapeHtml(execution)}</span></div><div><strong>Result</strong><span>${escapeHtml(result)}</span></div></div></details>`).join("")).join("");
}

function renderTestPlanRaw(themes: TestThemeModel[], highlighter: Highlighter, runs: TestExecutionRun[]): string {
  const cases = themes.flatMap((theme) => theme.cases);
  if (cases.length === 0) return `<p class="empty-note">No test activity was captured for this change.</p>`;
  const seen = new Set<string>();
  const artifacts = cases.flatMap((testCase) => {
    if (seen.has(testCase.hunk.id)) return [];
    seen.add(testCase.hunk.id);
    return [`<article class="test-raw-artifact"><h2>${escapeHtml(testCase.filePath)}</h2>${renderTestExcerpt(testCase.hunk, testCase.filePath, highlighter, true)}</article>`];
  });
  const commands = runs.length === 0
    ? `<p class="empty-note">Execution evidence not observed</p>`
    : runs.map((run) => `<article class="test-run"><code>${escapeHtml(run.command)}</code><span class="run-outcome run-outcome-${escapeHtml(run.outcome)}">${escapeHtml(run.outcome)}</span><p>${escapeHtml(run.summary)}</p><small>observed in the ${escapeHtml(run.source)}</small></article>`).join("");
  const output = runs.length === 0
    ? `<p class="empty-note">Execution evidence not observed</p>`
    : `<p class="empty-note">Only run summaries were captured; full output was not recorded.</p>`;
  return `<section class="test-raw-section"><h2>Changed test files</h2>${artifacts.join("")}</section><section class="test-raw-section"><h2>Observed commands</h2>${commands}</section><section class="test-raw-section"><h2>Complete output</h2>${output}</section>`;
}

function renderTestExcerpt(hunk: DiffHunk, filePath: string, highlighter: Highlighter, raw: boolean): string {
  const language = resolveLanguage(filePath);
  const lines = focusedTestLines(hunk, raw);
  const rendered = lines.map((line) => renderEvidenceLine(line, language, highlighter)).join("");
  return `<article class="evidence focused-evidence"><header><span class="evidence-path">${escapeHtml(filePath)}</span><span>${raw ? "Complete test artifact" : "Focused test excerpt"} · @@ −${hunk.oldStart} +${hunk.newStart} @@</span></header><pre>${rendered}</pre></article>`;
}

function requireHunk(hunks: DiffHunk[], id: string): DiffHunk {
  const hunk = hunks.find((candidate) => candidate.id === id);
  if (hunk === undefined) throw new Error(`Unknown hunk ${id}`);
  return hunk;
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char); }

/**
 * The ndrstnd galley system. One stylesheet, three typographic voices:
 * sans speaks UI chrome, mono speaks identifiers, serif speaks the story.
 * Light paper surfaces, hairline rules, a single cobalt accent, no gradients.
 */
export const styles = `
:root{color-scheme:light dark;--sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;--mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;--surface:#fff;--rail:#f6f6f4;--well:#fafaf8;--ink:#1c2126;--ink-2:#4a5258;--ink-3:#7d858c;--faint:#b4bac0;--hair:#e8e7e3;--hair-2:#d7d6d1;--accent:#2757cf;--wash:#eef2fb;--low:#2e8f53;--contained:#4d94c9;--elevated:#a97c15;--high:#b85f2e;--critical:#bf4840;--add-ink:#1c7a41;--add-bg:#eefaf1;--del-ink:#b04a3d;--del-bg:#fdf1ee;--shadow:0 18px 44px #191e2821}
*{box-sizing:border-box}html{overflow-x:hidden}body{margin:0;min-width:320px;background:var(--surface);color:var(--ink);font:13px/1.5 var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
[hidden]{display:none!important}
::selection{background:#d9e3f8}
button{font-family:inherit}
button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.app-shell{display:grid;grid-template-columns:236px minmax(0,1fr) 264px;min-height:100vh;transition:grid-template-columns 220ms ease}
.app-shell.sidebar-collapsed{grid-template-columns:64px minmax(0,1fr) 264px}
.app-shell.inspector-collapsed{grid-template-columns:236px minmax(0,1fr) 64px}
.app-shell.sidebar-collapsed.inspector-collapsed{grid-template-columns:64px minmax(0,1fr) 64px}

.sidebar{position:sticky;top:0;height:100vh;background:var(--rail);border-right:1px solid var(--hair);padding:20px 14px;overflow:hidden}
.brand{display:flex;align-items:center;gap:9px;padding:2px 6px 24px}
.brand-mark{width:19px;height:21px;flex:none;color:var(--ink)}
.brand-mark path{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.brand-mark .mark-deep{stroke:var(--accent)}
.brand-name{font:600 14px/1 var(--mono);letter-spacing:-.02em;color:var(--ink)}
.panel-toggle{display:grid;place-items:center;width:30px;height:30px;flex:none;padding:0;border:0;border-radius:7px;background:transparent;color:var(--ink-3);cursor:pointer;transition:background-color 140ms ease,color 140ms ease,transform 200ms ease}
.panel-toggle svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.panel-toggle:hover{background:#ebebe8;color:var(--ink)}
.collapse-sidebar{margin-left:auto}
.mobile-inspector-toggle{display:none}
.sidebar nav{display:grid;gap:2px}
.nav-item{position:relative;display:flex;align-items:center;gap:10px;width:100%;min-height:38px;padding:9px 10px;border:0;border-radius:7px;background:transparent;color:var(--ink-2);font:500 13px/1.2 var(--sans);text-align:left;cursor:pointer;transition:background-color 140ms ease,color 140ms ease}
.nav-icon{display:grid;place-items:center;width:18px;height:18px;flex:none}
.nav-icon svg{display:block;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.nav-item:hover{background:#ecece9;color:var(--ink)}
.nav-item.active{color:var(--accent)}
.nav-item.active::before{content:"";position:absolute;left:-14px;top:9px;bottom:9px;width:2px;border-radius:2px;background:var(--accent)}
.sidebar.collapsed{padding:20px 10px}
.sidebar.collapsed .brand{flex-direction:column;gap:12px;padding:2px 0 20px}
.sidebar.collapsed .brand-name{display:none}
.sidebar.collapsed .collapse-sidebar{margin:0;transform:rotate(180deg)}
.sidebar.collapsed .nav-item{justify-content:center;gap:0;min-height:42px;padding:10px 0;font-size:0}
.sidebar.collapsed .nav-item.active::before{left:-11px}

.main{min-width:0;width:100%;max-width:1040px;margin:0 auto;padding:38px 44px 96px}
.page-header{border-bottom:1px solid var(--hair);padding:0 280px 20px 0}
.masthead{min-width:0}
.masthead-overline{margin:0 0 12px;font:600 10px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3)}
.page-header h1{margin:0 0 9px;font:600 22px/1.3 var(--mono);letter-spacing:-.02em;color:var(--ink);word-break:break-word}
.breadcrumbs{display:flex;flex-wrap:wrap;align-items:center;gap:14px;font-size:12px;color:var(--ink-3)}
.breadcrumbs strong{color:var(--ink-2);font-weight:600}
.breadcrumbs code{font:500 11.5px var(--mono);color:var(--ink-2);background:var(--well);border:1px solid var(--hair);border-radius:6px;padding:2px 6px}
.view-bar{position:sticky;top:0;z-index:15;height:0;pointer-events:none}
.view-bar::before{content:"";position:absolute;top:0;left:-44px;right:-44px;height:62px;background:var(--surface);border-bottom:1px solid var(--hair);box-shadow:0 6px 20px #191e280f;opacity:0;transition:opacity 200ms ease}
.view-bar.view-bar-stuck::before{opacity:1;pointer-events:auto}
.view-bar .story-zoom-controls{position:absolute;top:-112px;right:0;pointer-events:auto;transition:top 240ms cubic-bezier(.2,.8,.2,1)}
.view-bar.view-bar-stuck .story-zoom-controls{top:5px}
.view-bar .lens-label{position:absolute;top:-104px;right:246px;pointer-events:auto;transition:top 240ms cubic-bezier(.2,.8,.2,1)}
.view-bar.view-bar-stuck .lens-label{top:13px}
.view-bar-ref{position:absolute;left:0;top:20px;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 11.5px/1.4 var(--mono);color:var(--ink-3);opacity:0;transition:opacity 200ms ease}
.view-bar.view-bar-stuck .view-bar-ref{opacity:1}
.lens-label{display:flex;align-items:center;gap:7px;color:var(--ink-3);font-size:12px}
.lens-label select{border:1px solid var(--hair-2);border-radius:7px;background:var(--surface);padding:7px 10px;color:var(--ink);font:inherit;min-height:34px}
.notice{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--wash);border:1px solid #d7e0f4;border-radius:10px;margin-top:16px;padding:10px 12px;color:#41506e;font-size:12px}
.notice button{border:0;background:var(--accent);color:#fff;border-radius:7px;min-height:34px;padding:7px 12px;font:600 12px var(--sans);cursor:pointer}

.story-zoom-controls{position:relative;display:flex;align-items:flex-start;gap:2px;height:52px;padding-top:2px}
.story-zoom-controls[hidden]{display:none!important}
.story-zoom-controls>button[data-zoom-step]{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--ink-3);font:400 17px/1 var(--sans);cursor:pointer;transition:background-color 140ms ease,color 140ms ease}
.story-zoom-controls>button[data-zoom-step]:hover{background:var(--well);color:var(--ink)}
.zoom{position:relative;display:flex;align-items:flex-end;justify-content:space-between;width:186px;height:30px;padding:0 5px;border:0}
.zoom::before{content:"";position:absolute;left:9px;right:9px;bottom:3px;height:1px;background:var(--hair-2)}
.zoom button{position:relative;z-index:1;width:24px;height:30px;min-height:0;padding:0;border:0;background:transparent;cursor:pointer}
.zoom button::before{content:"";position:absolute;left:50%;bottom:3px;width:2px;height:9px;border-radius:1px 1px 0 0;background:var(--hair-2);transform:translateX(-50%);transition:background-color 160ms ease,height 200ms cubic-bezier(.3,1.3,.4,1),width 160ms ease}
.zoom button:hover::before{background:var(--ink-3);height:13px}
.zoom button.active::before{background:var(--accent);height:17px;width:2.5px}
.zoom button::after{content:"";position:absolute;left:50%;bottom:23px;width:5px;height:5px;border-radius:50%;background:var(--accent);transform:translateX(-50%) scale(0);opacity:0;transition:transform 200ms cubic-bezier(.3,1.3,.4,1),opacity 160ms ease}
.zoom button.active::after{opacity:1;transform:translateX(-50%) scale(1)}
.zoom-callout{position:absolute;left:50%;top:calc(100% + 3px);transform:translateX(-50%);white-space:nowrap;text-align:center;pointer-events:none;transition:opacity 160ms ease}
.zoom-callout output{font:700 10px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.zoom-callout span{margin-left:8px;font:400 11px/1 var(--sans);color:var(--ink-3)}
.zoom.is-changing .zoom-callout{opacity:.45}

.view{display:none}
.view.active{display:block;animation:view-in 240ms ease}
.review-summary{margin:30px 0 10px;max-width:42em;font:400 20px/1.55 var(--sans);letter-spacing:-.01em;color:var(--ink)}
.coverage{margin:0 0 22px;font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.story-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px}
.map{display:flex;flex-wrap:wrap;gap:8px 18px}
.map div{display:inline-flex;align-items:center;gap:7px;font:500 11px/1 var(--sans);letter-spacing:.02em;color:var(--ink-2);text-transform:capitalize}
.map strong{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.dot{width:7px;height:7px;border-radius:50%;background:var(--low)}
.dot.contained{background:var(--contained)}.dot.elevated{background:var(--elevated)}.dot.high{background:var(--high)}.dot.critical{background:var(--critical)}
#collapse-all{margin-left:auto;border:0;border-radius:7px;background:transparent;min-height:30px;padding:6px 10px;font:500 12px var(--sans);color:var(--ink-3);cursor:pointer;transition:background-color 140ms ease,color 140ms ease}
#collapse-all:hover{background:var(--well);color:var(--ink)}
body.story-level-0 #collapse-all,body.story-level-1 #collapse-all{display:none}

.chapter-list{border:1px solid var(--hair);border-radius:12px;background:var(--surface);overflow:hidden}
.chapter{border-bottom:1px solid var(--hair)}
.chapter:last-child{border-bottom:0}
.chapter-toggle{display:grid;grid-template-columns:46px minmax(0,1fr) 18px;align-items:start;gap:12px;width:100%;padding:17px 18px 15px;border:0;background:transparent;text-align:left;cursor:pointer;transition:background-color 140ms ease}
.chapter-toggle:hover,.chapter.open .chapter-toggle{background:var(--well)}
.chapter-number{position:relative;font:700 12.5px/1 var(--mono);letter-spacing:.08em;color:var(--ink-3);padding:6px 0 15px}
.chapter-number::after{content:"";position:absolute;left:1px;bottom:2px;width:16px;height:3px;border-radius:2px;background:var(--hair-2)}
.chapter-number.attention-low{color:var(--low)}
.chapter-number.attention-contained{color:var(--contained)}
.chapter-number.attention-elevated{color:var(--elevated)}
.chapter-number.attention-high{color:var(--high)}
.chapter-number.attention-critical{color:var(--critical)}
.chapter-number.attention-low::after{background:var(--low)}
.chapter-number.attention-contained::after{background:var(--contained)}
.chapter-number.attention-elevated::after{background:var(--elevated)}
.chapter-number.attention-high::after{background:var(--high)}
.chapter-number.attention-critical::after{background:var(--critical)}
.chapter-copy{display:grid;gap:4px;min-width:0}
.chapter-copy strong{font:600 14.5px/1.4 var(--sans);color:var(--ink)}
.chapter-copy small{font:400 12.5px/1.5 var(--sans);color:var(--ink-3)}
.chapter-tags,.chapter-steps{display:flex;flex-wrap:wrap;gap:5px 6px;margin-top:8px}
.chapter-tag{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border:1px solid var(--hair);border-radius:999px;background:var(--surface);font:600 9.5px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.step-chip,.evidence-step-tag{display:inline-flex;align-items:center;min-height:22px;padding:3px 8px;border:0;border-radius:7px;background:var(--well);font:700 9.5px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--accent);cursor:pointer}
.step-chip:hover,.evidence-step-tag:hover{background:var(--wash)}
.tag-icon{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.chevron{display:grid;place-items:center;width:18px;height:18px;margin-top:3px;color:var(--faint);transition:transform 200ms ease,color 140ms ease}
.chevron svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.chapter-toggle:hover .chevron{color:var(--ink-2)}
.chapter.open .chevron{transform:rotate(180deg)}
.chapter-list,.map,.chapter-detail,.semantic,.evidence-stack,.evidence{transition:opacity 220ms ease,transform 220ms ease,max-height 260ms ease,margin 220ms ease,padding 220ms ease}
.chapter-detail{max-height:0;opacity:0;overflow:hidden;padding:0 18px 0 76px;transform:translateY(-4px)}
.chapter.open .chapter-detail{max-height:4000px;opacity:1;padding-top:2px;padding-bottom:22px;transform:none}

.raw-code,.raw-label{display:none}
.story-level-0 .chapter-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;border:0;border-radius:0;background:transparent;overflow:visible;pointer-events:none}
.story-level-0 .chapter{border:1px solid var(--hair);border-radius:12px;background:var(--surface);animation:rise 240ms ease both}
.story-level-0 .chapter:nth-child(2){animation-delay:35ms}
.story-level-0 .chapter:nth-child(3){animation-delay:70ms}
.story-level-0 .chapter:nth-child(4){animation-delay:105ms}
.story-level-0 .chapter:nth-child(5){animation-delay:140ms}
.story-level-0 .chapter:nth-child(n+6){animation-delay:175ms}
.story-level-0 .chapter-toggle{grid-template-columns:38px minmax(0,1fr);gap:12px;min-height:132px;padding:16px;cursor:default}
.story-level-0 .chapter-toggle:hover{background:transparent}
.story-level-0 .chapter-copy{min-height:96px;gap:7px}
.story-level-0 .chapter-copy strong{font-size:15px}
.story-level-0 .chapter-copy small{display:none}
.story-level-0 .chevron{display:none}
.story-level-0 .chapter-detail{display:none!important}
.chapter-map-meta,.chapter-churn-bar{display:none}
.story-level-0 .chapter-map-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin-top:auto;font:400 10.5px/1.3 var(--mono);color:var(--ink-3)}
.story-level-0 .chapter-churn{display:flex;gap:7px;font:600 11px/1.2 var(--mono)}
.story-level-0 .chapter-map-meta .additions{color:var(--add-ink)}
.story-level-0 .chapter-map-meta .deletions{color:var(--del-ink)}
.story-level-0 .chapter-churn-bar{display:flex;width:100%;height:3px;margin-top:4px;overflow:hidden;border-radius:999px;background:var(--hair)}
.story-level-0 .chapter-churn-bar i{display:block}
.story-level-0 .chapter-churn-bar .additions{width:calc(var(--add) * 1%);background:#79bd93}
.story-level-0 .chapter-churn-bar .deletions{width:calc(var(--delete) * 1%);background:#dd9d92}
.story-level-0 .map{animation:rise 240ms ease both}
.zoom-revealed{animation:story-enter 260ms ease both}
.story-level-1 .chapter-toggle{cursor:default}
.story-level-1 .chapter-toggle:hover{background:transparent}
.story-level-1 .chapter-detail{max-height:0!important;opacity:0!important;padding-top:0!important;padding-bottom:0!important;transform:translateY(-4px)!important}
.story-level-1 .chevron{display:none}
.story-level-2 .evidence-stack{display:none}
.story-level-3 .evidence pre{max-height:238px;overflow-y:auto}
.story-level-4 .focused-code,.story-level-4 .focused-label,.story-level-4 .evidence-context{display:none}
.story-level-4 .raw-code{display:block}
.story-level-4 .raw-label{display:inline}

.semantic{display:grid;grid-template-columns:1fr 1fr;gap:22px;padding:14px 0 16px;border-bottom:1px solid var(--hair);margin-bottom:14px}
.semantic>div+div{border-left:1px solid var(--hair);padding-left:22px}
.semantic strong{display:block;font:600 10px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.semantic p{margin:7px 0 0;font:400 13px/1.6 var(--sans);color:var(--ink-2)}
.evidence{border:1px solid var(--hair);border-radius:10px;overflow:hidden;margin-top:12px;background:var(--surface)}
.evidence header{display:flex;justify-content:space-between;align-items:baseline;gap:14px;padding:8px 12px;border-bottom:1px solid var(--hair);background:var(--well);font:400 11px/1.4 var(--mono);color:var(--ink-3)}
.evidence-path{font-weight:600;color:var(--ink-2)}
.evidence pre{margin:0;padding:8px 0;background:var(--surface);overflow-x:auto;-webkit-overflow-scrolling:touch;font:12px/1.6 var(--mono)}
.line{display:grid;grid-template-columns:40px 40px 1fr;min-width:max-content;padding:0 12px}
.line b{font-weight:400;font-size:11px;color:var(--faint);text-align:right;padding-right:10px;user-select:none;font-variant-numeric:tabular-nums}
.line code{font:inherit;color:#24292e}
.line.addition{background:var(--add-bg)}
.line.deletion{background:var(--del-bg)}
.diff-prefix{display:inline-block;width:1.2ch;color:var(--faint);user-select:none}
.line.addition .diff-prefix{color:var(--add-ink)}
.line.deletion .diff-prefix{color:var(--del-ink)}
.token-italic{font-style:italic}
.line.omission{display:block;min-width:0;padding:4px 12px}
.omission-divider{display:flex;align-items:center;gap:8px;color:var(--faint)}
.omission-divider i{height:0;flex:1;border-top:1px dashed var(--hair-2)}
.omission-divider b{font:600 12px/1 var(--mono);letter-spacing:-2px}
.evidence-context{margin:0;padding:6px 12px;border-top:1px solid var(--hair);background:var(--well);font-size:10.5px;color:var(--ink-3)}
.omitted{margin-top:16px;border:1px dashed var(--hair-2);border-radius:10px;padding:12px 14px;color:var(--ink-3);font-size:12px}
.omitted summary{cursor:pointer;color:var(--ink-2);font-weight:500}
.omitted p{margin:8px 0 0;line-height:1.5}
.omitted strong{color:var(--ink-2)}
.other-files{margin-top:16px;border:1px solid var(--hair);border-radius:12px;overflow:hidden;background:var(--surface)}
.other-files h2{margin:0;padding:11px 14px;border-bottom:1px solid var(--hair);background:var(--well);font:600 10px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.other-files ul{margin:0;padding:0;list-style:none}
.other-files li{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:38px;padding:9px 14px;font:12px/1.3 var(--mono);color:var(--ink-2)}
.other-files li+li{border-top:1px solid var(--hair)}
.other-files small{display:flex;gap:8px;font:600 11px/1 var(--mono);font-variant-numeric:tabular-nums}
.other-files .additions{color:var(--add-ink)}
.other-files .deletions{color:var(--del-ink)}

.section-title{margin:30px 0 6px;font:600 10px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3)}
.timeline{position:relative;margin-top:16px}
.timeline-rail{position:sticky;top:70px;z-index:10;display:grid;grid-template-columns:30px minmax(0,1fr) 30px;align-items:center;column-gap:8px;margin:0 0 16px;padding:9px 12px 7px;border:1px solid var(--hair);border-radius:12px;background:var(--surface)}
.rail-nav{display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--ink-3);cursor:pointer;transition:background-color 140ms ease,color 140ms ease}
.rail-nav:hover{background:var(--well);color:var(--ink)}
.rail-nav[disabled]{opacity:.35;cursor:default}
.rail-nav[disabled]:hover{background:transparent;color:var(--ink-3)}
.rail-nav svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.rail-ticks{position:relative;display:flex;align-items:flex-end;height:28px;min-width:0}
.rail-ticks::before{content:"";position:absolute;left:2px;right:2px;bottom:4px;height:1px;background:var(--hair-2)}
.rail-tick{position:relative;flex:1;min-width:4px;height:28px;padding:0;border:0;background:transparent;cursor:pointer}
.rail-tick::before{content:"";position:absolute;left:50%;bottom:4px;width:2px;height:9px;border-radius:1px 1px 0 0;background:var(--hair-2);transform:translateX(-50%);transition:background-color 160ms ease,height 200ms cubic-bezier(.3,1.3,.4,1),width 160ms ease}
.rail-tick.attention-low::before{background:var(--low)}
.rail-tick.attention-contained::before{background:var(--contained)}
.rail-tick.attention-elevated::before{background:var(--elevated)}
.rail-tick.attention-high::before{background:var(--high)}
.rail-tick.attention-critical::before{background:var(--critical)}
.rail-tick:hover::before{height:13px}
.rail-tick.active::before{background:var(--accent);height:17px;width:2.5px}
.rail-readout{grid-column:1/-1;display:flex;align-items:baseline;gap:10px;margin:4px 2px 0!important;max-width:none!important;min-width:0}
.rail-readout output{flex:none;font:700 10px/1 var(--mono);letter-spacing:.14em;color:var(--accent);font-variant-numeric:tabular-nums}
.rail-readout span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 11.5px/1.3 var(--sans);color:var(--ink-2)}
.timeline-plan{position:relative;display:none}
.timeline-plan::before{content:"";position:absolute;left:9px;top:26px;bottom:26px;width:1px;background:var(--hair)}
.timeline-plan-step{position:relative;display:grid;grid-template-columns:40px minmax(0,1fr);gap:12px;width:100%;padding:15px 2px 15px 30px;border:0;border-bottom:1px solid var(--hair);background:transparent;text-align:left;cursor:pointer}
.timeline-plan-step:last-child{border-bottom:0}
.timeline-plan-step::before{content:"";position:absolute;left:5.5px;top:21px;width:8px;height:8px;border-radius:50%;background:var(--low);box-shadow:0 0 0 3px var(--surface)}
.timeline-plan-step.attention-contained::before{background:var(--contained)}
.timeline-plan-step.attention-elevated::before{background:var(--elevated)}
.timeline-plan-step.attention-high::before{background:var(--high)}
.timeline-plan-step.attention-critical::before{background:var(--critical)}
.timeline-plan-step>span{padding-top:2px;font:700 12.5px/1 var(--mono);letter-spacing:.08em;color:var(--low)}
.timeline-plan-step.attention-contained>span{color:var(--contained)}
.timeline-plan-step.attention-elevated>span{color:var(--elevated)}
.timeline-plan-step.attention-high>span{color:var(--high)}
.timeline-plan-step.attention-critical>span{color:var(--critical)}
.timeline-plan-step strong{display:block;font:600 14.5px/1.4 var(--sans);color:var(--ink);transition:color 140ms ease}
.timeline-plan-step p{margin:3px 0 0}
.timeline-plan-step:hover strong{color:var(--accent)}
.timeline-state{display:none}
.timeline-state.active{display:block}
.timeline-card{display:grid;grid-template-columns:44px minmax(0,1fr);gap:12px;padding:16px 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair)}
.timeline-card h2{margin:0 0 6px;font:600 16px/1.35 var(--sans);color:var(--ink)}
.timeline-index{font:700 12.5px/1 var(--mono);letter-spacing:.08em;color:var(--ink-3);padding-top:5px}
.timeline-index.attention-low{color:var(--low)}
.timeline-index.attention-contained{color:var(--contained)}
.timeline-index.attention-elevated{color:var(--elevated)}
.timeline-index.attention-high{color:var(--high)}
.timeline-index.attention-critical{color:var(--critical)}
.timeline p{margin:0;max-width:60em;font:400 12.5px/1.55 var(--sans);color:var(--ink-3)}
.timeline-summary,.timeline-explanation{border:1px solid var(--hair);border-radius:10px;background:var(--surface);padding:14px;margin-top:14px}
.timeline-summary strong,.timeline-explanation h3{display:block;margin:0 0 7px;font:700 10px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.timeline-summary p{color:var(--ink-2)}
.timeline-explanation{grid-template-columns:1fr 1fr;gap:18px}
.timeline-explanation section+section{border-left:1px solid var(--hair);padding-left:18px}
.timeline-explanation ul{margin:0;padding-left:18px;color:var(--ink-2)}
.timeline-explanation li{margin:4px 0;font-size:12.5px}
.timeline-explanation button,.timeline-chapter-links button{border:0;border-radius:7px;background:var(--well);min-height:24px;padding:4px 8px;color:var(--accent);font:600 11px/1 var(--sans);cursor:pointer}
.timeline-chapter-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.timeline-evidence,.timeline-raw{margin-top:14px}
.timeline-evidence-divider{margin:20px 0 2px!important;font:600 10px/1 var(--mono)!important;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)!important}
.timeline-evidence-item{opacity:.62}
.timeline-evidence-item.current{opacity:1}
.timeline-evidence-item.current .evidence{border-color:#c9d5f5;box-shadow:0 0 0 1px #d9e3f8}
.timeline-summary,.timeline-explanation,.timeline-evidence,.timeline-raw{display:none}
.story-level-0 #timeline .timeline-rail{display:none}
.story-level-0 #timeline .timeline-plan{display:block}
.story-level-0 #timeline .timeline-states{display:none}
.story-level-1 #timeline .timeline-summary{display:block}
.story-level-2 #timeline .timeline-summary{display:block}
.story-level-2 #timeline .timeline-explanation{display:grid}
.story-level-3 #timeline .timeline-explanation{display:grid}
.story-level-3 #timeline .timeline-evidence{display:block}
.story-level-4 #timeline .timeline-raw{display:block}
.timeline-files{display:flex;flex-direction:column;gap:4px;margin-top:10px}
.timeline-file{display:flex;align-items:center;gap:12px;font:11px/1.4 var(--mono);color:var(--ink-2)}
.timeline-file small{display:flex;gap:7px;font:600 10.5px/1 var(--mono)}
.timeline-file .additions{color:var(--add-ink)}
.timeline-file .deletions{color:var(--del-ink)}

.file{border:1px solid var(--hair);border-radius:12px;margin:12px 0;overflow:hidden;background:var(--surface)}
.file>summary{display:flex;align-items:center;gap:12px;padding:11px 14px;background:var(--well);cursor:pointer;list-style:none}
.file>summary::-webkit-details-marker{display:none}
.file-path{font:600 12px/1.4 var(--mono);color:var(--ink-2);min-width:0;overflow-wrap:anywhere}
.file>summary small{margin-left:auto;flex:none;color:var(--ink-3);font-size:11.5px}
.file>summary::after{content:"";width:7px;height:7px;flex:none;margin-top:-2px;border-right:1.6px solid var(--ink-3);border-bottom:1.6px solid var(--ink-3);transform:rotate(-45deg);transition:transform 180ms ease}
.file[open]>summary::after{margin-top:-4px;transform:rotate(45deg)}
.diff-block{border-top:1px solid var(--hair)}
.diff-hunk-header{padding:6px 12px;background:var(--well);border-bottom:1px solid var(--hair);font:11px/1.4 var(--mono);color:var(--ink-3)}
.diff-block pre{margin:0;padding:8px 0;overflow-x:auto;-webkit-overflow-scrolling:touch;font:12px/1.6 var(--mono)}

.test-plan-subtitle,.view-subtitle{margin:8px 0 18px;max-width:56em;font:400 13px/1.6 var(--sans);color:var(--ink-2)}
.test-plan-summary{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 18px}
.test-plan-summary span,.test-inline-meta span,.test-theme-meta span,.test-refs span,.test-state{display:inline-flex;align-items:center;min-height:24px;padding:3px 10px;border:1px solid var(--hair);border-radius:999px;background:var(--surface);color:var(--ink-2);font:500 11px/1.2 var(--sans);font-variant-numeric:tabular-nums}
.test-plan-level{display:none}
.story-level-0 #tests .test-plan-map,.story-level-1 #tests .test-plan-summary-level,.story-level-2 #tests .test-plan-explanation,.story-level-3 #tests .test-plan-evidence,.story-level-4 #tests .test-plan-raw{display:block}
.test-generated-summary{margin:0 0 14px;max-width:56em;font:400 13px/1.6 var(--sans);color:var(--ink-2)}
.test-theme-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.test-theme-card{display:flex;flex-direction:column;min-height:128px;border:1px solid var(--hair);border-radius:12px;background:var(--surface);padding:16px}
.test-theme-card h2{margin:0 0 6px;font:600 14px/1.4 var(--sans);color:var(--ink)}
.test-theme-card p{margin:0;font:400 12.5px/1.5 var(--sans);color:var(--ink-3)}
.test-theme-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto;padding-top:14px}
.test-behavior-group,.test-explanation-group,.test-raw-section{border:1px solid var(--hair);border-radius:12px;background:var(--surface);margin:0 0 14px;padding:16px}
.test-behavior-group h2,.test-explanation-group h2{margin:0 0 8px;font:600 14px/1.4 var(--sans);color:var(--ink)}
.test-raw-section>h2{margin:0 0 8px;font:600 10px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.test-behavior{border-top:1px solid var(--hair);padding:12px 0}
.test-behavior:first-of-type{border-top:0}
.test-behavior button{display:grid;gap:4px;width:100%;border:0;background:transparent;padding:0;text-align:left;cursor:pointer}
.test-behavior button:hover strong{color:var(--accent)}
.test-behavior strong,.test-evidence-card summary strong{font:600 13.5px/1.4 var(--sans);color:var(--ink);transition:color 140ms ease}
.test-behavior button span,.test-evidence-card summary small{font:400 12px/1.5 var(--sans);color:var(--ink-3)}
.test-inline-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.test-explanation-card{border-top:1px solid var(--hair);padding:14px 0}
.test-explanation-card:first-of-type{border-top:0}
.test-explanation-card h3{margin:0 0 10px;font:600 13.5px/1.4 var(--sans);color:var(--ink)}
.test-explanation-card .semantic{margin:0 0 12px;padding-top:0}
.test-what{margin:0 0 12px;max-width:56em;font:400 13px/1.6 var(--sans);color:var(--ink-2)}
.test-refs{display:flex;flex-wrap:wrap;gap:6px}
.test-ref-file{font-family:var(--mono);font-size:10.5px}
.test-evidence-card{border:1px solid var(--hair);border-radius:12px;background:var(--surface);margin:0 0 12px;overflow:hidden}
.test-evidence-card summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;background:var(--well);list-style:none}
.test-evidence-card summary::-webkit-details-marker{display:none}
.test-evidence-card summary>span:first-child{display:grid;gap:3px;min-width:0}
.test-evidence-card .evidence{border-left:0;border-right:0;border-bottom:0;border-radius:0;margin:0}
.test-evidence-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:12px 14px;border-top:1px solid var(--hair)}
.test-evidence-meta div{display:grid;gap:3px}
.test-evidence-meta strong{font:600 10px/1.4 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.test-evidence-meta span{font-size:12px;color:var(--ink-2)}
.test-raw-artifact{margin:12px 0 0}
.test-raw-artifact h2{margin:0 0 8px;font:600 12px/1.4 var(--mono);color:var(--ink-2)}
.test-raw-section .empty-note{margin:4px 0 0}
.test-run{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin:8px 0;font:12.5px/1.5 var(--sans);color:var(--ink-2)}
.test-run code{font:11.5px var(--mono);color:var(--ink)}
.test-run p{margin:0;flex-basis:100%}
.test-run small{color:var(--ink-3)}
.run-outcome{font:600 11px/1 var(--sans);text-transform:uppercase;letter-spacing:.04em}
.run-outcome-passed{color:var(--low)}
.run-outcome-failed{color:var(--critical)}
.run-outcome-mixed,.run-outcome-unknown{color:var(--elevated)}
.empty-note{font:400 12.5px/1.5 var(--sans);color:var(--ink-3)}

.inspector{position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--rail);border-left:1px solid var(--hair);padding:22px 20px}
.inspector-header{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:30px}
.inspector h2{margin:0;font:600 13px/1.2 var(--sans);color:var(--ink)}
.inspector-content{min-width:0}
.inspector section{padding:18px 0;border-bottom:1px solid var(--hair)}
.inspector section:last-of-type{border-bottom:0}
.inspector h3{margin:0 0 10px;font:600 10px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.stat-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0;font-size:12.5px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.stat-row>span{display:inline-flex;align-items:center;gap:8px;min-width:0}
.stat-category>span{text-transform:capitalize}
.stat-row strong{font:600 12px/1.4 var(--mono);color:var(--ink)}
.stat-row .tag-icon{width:14px;height:14px;flex:none;color:var(--ink-3)}
.inspector-action{display:flex;align-items:center;gap:9px;width:100%;min-height:36px;margin-top:8px;padding:8px 11px;border:0;border-radius:8px;background:#ecece9;color:var(--ink);font:500 12.5px/1.2 var(--sans);cursor:pointer;transition:background-color 140ms ease}
.inspector-action:first-of-type{margin-top:0}
.inspector-action:hover{background:#e2e2de}
.inspector-action svg{width:15px;height:15px;flex:none;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;color:var(--ink-3)}
.inspector-collapsed .inspector{padding:22px 10px}
.inspector-collapsed .inspector-header{justify-content:center}
.inspector-collapsed .inspector h2,.inspector-collapsed .inspector-content{display:none}
.inspector-collapsed .collapse-inspector{transform:rotate(180deg)}

.colophon{display:flex;align-items:center;gap:9px;margin-top:56px;padding-top:16px;border-top:1px solid var(--hair);font:600 10px/1.6 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.colophon svg{width:12px;height:13px;flex:none;color:var(--faint)}
.colophon svg path{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.colophon svg .mark-deep{stroke:var(--accent)}
.selection-menu{position:fixed;z-index:30;display:flex;gap:2px;max-width:calc(100vw - 16px);overflow-x:auto;padding:4px;border:1px solid var(--hair);border-radius:11px;background:var(--surface);box-shadow:var(--shadow)}
.selection-menu[hidden]{display:none!important}
.selection-menu button{border:0;background:transparent;min-height:36px;padding:8px 11px;border-radius:8px;color:var(--ink-2);font:500 12px/1.2 var(--sans);cursor:pointer;white-space:nowrap;transition:background-color 120ms ease,color 120ms ease}
.selection-menu button:hover{background:var(--wash);color:var(--accent)}
.toast{position:fixed;right:20px;bottom:20px;z-index:40;max-width:calc(100vw - 32px);background:#22262b;color:#f5f5f3;border-radius:9px;padding:11px 14px;font:500 12.5px/1.4 var(--sans);box-shadow:var(--shadow);animation:rise 200ms ease}

@keyframes story-enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes view-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@keyframes sheet-in{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
@keyframes fade-in{from{opacity:0}to{opacity:1}}

@media(max-width:1160px){.app-shell{grid-template-columns:204px minmax(0,1fr) 236px}.app-shell.sidebar-collapsed{grid-template-columns:64px minmax(0,1fr) 236px}.app-shell.inspector-collapsed{grid-template-columns:204px minmax(0,1fr) 64px}.app-shell.sidebar-collapsed.inspector-collapsed{grid-template-columns:64px minmax(0,1fr) 64px}.main{padding:32px 28px 72px}.view-bar::before{left:-28px;right:-28px}.story-level-0 .chapter-list,.test-theme-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:980px){.test-evidence-meta{grid-template-columns:1fr}}
@media(max-width:1080px){
.app-shell,.app-shell.inspector-collapsed{grid-template-columns:204px minmax(0,1fr)}
.app-shell.sidebar-collapsed,.app-shell.sidebar-collapsed.inspector-collapsed{grid-template-columns:64px minmax(0,1fr)}
.mobile-inspector-toggle{display:grid;margin-left:6px}
.inspector{display:none}
.app-shell.mobile-inspector-open::before{content:"";position:fixed;inset:0;z-index:35;background:rgba(17,21,28,.32);animation:fade-in 220ms ease both}
.app-shell.mobile-inspector-open .inspector{display:block;position:fixed;z-index:40;inset:auto 10px calc(10px + env(safe-area-inset-bottom)) 10px;height:auto;max-height:min(76vh,600px);overflow:auto;border:1px solid var(--hair);border-radius:14px;padding:18px;background:var(--surface);box-shadow:var(--shadow);animation:sheet-in 300ms cubic-bezier(.2,.9,.25,1) both}
.app-shell.mobile-inspector-open .inspector-content{display:block}
.app-shell.mobile-inspector-open .inspector h2{display:block}
.app-shell.mobile-inspector-open .collapse-inspector{transform:rotate(180deg)}
.inspector-collapsed .inspector{padding:18px}
.inspector-collapsed .inspector h2,.inspector-collapsed .inspector-content{display:block}
.inspector-collapsed .inspector-header{justify-content:space-between}
}
@media(max-width:760px){
.app-shell,.app-shell.sidebar-collapsed,.app-shell.inspector-collapsed,.app-shell.sidebar-collapsed.inspector-collapsed{display:block}
.sidebar,.sidebar.collapsed{position:sticky;top:0;z-index:20;width:auto;height:auto;padding:8px 14px 0;background:var(--surface);border-right:0;border-bottom:1px solid var(--hair);overflow:visible}
.brand,.sidebar.collapsed .brand{flex-direction:row;gap:9px;min-height:44px;padding:2px 0 8px}
.brand-name,.sidebar.collapsed .brand-name{display:inline}
.collapse-sidebar,.sidebar.collapsed .collapse-sidebar{margin:0 0 0 auto}
.collapse-sidebar{transform:rotate(90deg)}
.sidebar.collapsed .collapse-sidebar{transform:rotate(-90deg)}
.mobile-inspector-toggle{display:grid;margin-left:6px}
.sidebar nav,.sidebar.collapsed nav{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:0;margin:0 -14px;border-top:1px solid var(--hair);overflow:hidden;max-height:64px;transition:max-height 200ms ease,border-color 200ms ease}
.sidebar.collapsed nav{max-height:0;border-top-color:transparent}
.nav-item,.sidebar.collapsed .nav-item{flex-direction:column;justify-content:center;gap:5px;width:auto;min-height:56px;padding:8px 4px;border-radius:0;font:500 11px/1 var(--sans);color:var(--ink-3)}
.nav-icon svg{width:19px;height:19px}
.nav-item.active,.sidebar.collapsed .nav-item.active{color:var(--accent);background:transparent;box-shadow:inset 0 -2px var(--accent)}
.nav-item.active::before{display:none}
.main{padding:22px 16px 150px}
.page-header{display:block;padding:0 0 16px}
.page-header h1{font-size:17px}
.breadcrumbs{gap:10px;font-size:11.5px}
.view-bar{position:fixed;left:12px;right:12px;top:auto;bottom:calc(10px + env(safe-area-inset-bottom));z-index:25;display:flex;flex-wrap:wrap;gap:0;height:auto;margin:0;padding:4px 10px 6px;background:var(--surface);border:1px solid var(--hair);border-radius:16px;box-shadow:var(--shadow);pointer-events:auto}
.view-bar::before{display:none}
.view-bar .story-zoom-controls{position:relative;top:0;right:auto}
.view-bar .lens-label{position:static}
.view-bar-ref{display:none}
.view-bar.view-bar-empty{display:none}
.lens-label{width:100%;justify-content:space-between;margin:6px 4px 2px}
.story-zoom-controls{flex:1;width:100%;height:66px;padding-top:0}
.zoom{flex:1;width:auto;height:46px;padding:0 6px}
.zoom button{width:40px;height:46px}
.zoom::before{left:26px;right:26px;bottom:10px}
.zoom button::before{bottom:10px}
.zoom button::after{bottom:32px}
.story-zoom-controls>button[data-zoom-step]{width:40px;height:46px;font-size:19px}
.zoom-callout{top:calc(100% - 1px)}
.review-summary{margin-top:22px;font-size:17px}
.story-toolbar{flex-wrap:wrap}
.chapter-toggle{grid-template-columns:38px minmax(0,1fr) 16px;gap:10px;padding:14px}
.chapter-number{font-size:16px}
.chapter-detail{padding:0 14px}
.chapter.open .chapter-detail{padding-top:2px;padding-bottom:18px}
.semantic{grid-template-columns:1fr;gap:12px}
.semantic>div+div{border-left:0;border-top:1px solid var(--hair);padding-left:0;padding-top:12px}
.evidence header{flex-direction:column;align-items:flex-start;gap:3px}
.line{grid-template-columns:34px 34px 1fr;padding:0 8px}
.line.omission{padding:4px 8px}
.file>summary{flex-wrap:wrap}
.story-level-0 .chapter-list{grid-template-columns:1fr;gap:10px}
.story-level-0 .chapter-toggle{min-height:0}
.story-level-0 .chapter-copy{min-height:0}
.test-theme-grid{grid-template-columns:1fr}
.test-evidence-card summary{flex-direction:column;align-items:flex-start}
.timeline-rail{top:8px;grid-template-columns:34px minmax(0,1fr) 34px;padding:8px 8px 6px}
.rail-nav{width:34px;height:34px}
.timeline-explanation{grid-template-columns:1fr}
.story-level-2 #timeline .timeline-explanation,.story-level-3 #timeline .timeline-explanation{grid-template-columns:1fr}
.timeline-explanation section+section{border-left:0;border-top:1px solid var(--hair);padding-left:0;padding-top:14px}
.timeline-card{grid-template-columns:36px minmax(0,1fr)}
.selection-menu{left:8px!important;right:8px;top:auto!important;bottom:calc(94px + env(safe-area-inset-bottom))}
.toast{left:16px;right:16px;bottom:calc(98px + env(safe-area-inset-bottom));text-align:center}
}
@media(max-width:380px){.main{padding-left:12px;padding-right:12px}.breadcrumbs code{font-size:10.5px}.nav-item,.sidebar.collapsed .nav-item{font-size:10px}}
@media(prefers-color-scheme:dark){
:root{--surface:#15181c;--rail:#1b1f24;--well:#191d22;--ink:#e7eaed;--ink-2:#b4bbc2;--ink-3:#868f97;--faint:#565e66;--hair:#272c33;--hair-2:#3a414a;--accent:#7b9ce8;--wash:#1c2536;--low:#46a86c;--contained:#6cb6e6;--elevated:#cfa145;--high:#dd8a5b;--critical:#e07268;--add-ink:#5cb883;--add-bg:#152b1d;--del-ink:#e08a7a;--del-bg:#2f1b17;--shadow:0 18px 44px #00000059}
::selection{background:#2c3e66}
.panel-toggle:hover{background:#262c33}
.nav-item:hover{background:#232930}
.notice{border-color:#2f3d5e;color:#b9c4dc}
.notice button{color:#10131a}
.line code{color:#c9d1d9}
.line code .tk{color:var(--shiki-dark,currentColor)!important}
.chapter-churn-bar .additions{background:#3f7f57}
.chapter-churn-bar .deletions{background:#96584e}
.inspector-action{background:#232930}
.inspector-action:hover{background:#2b323a}
.toast{border:1px solid #3a414a}
.app-shell.mobile-inspector-open::before{background:rgba(0,0,0,.5)}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
`;

export const clientScript = `
(() => {
  const state = ndrstnd;
  const byId = (id) => document.getElementById(id);
  const toast = (message) => { const node = byId('toast'); node.textContent = message; node.hidden = false; window.setTimeout(() => { node.hidden = true; }, 3600); };
  const api = async (path, init = {}) => { const separator = path.includes('?') ? '&' : '?'; const response = await fetch(path + separator + 'token=' + encodeURIComponent(state.token), init); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed'); return result; };
  let selectedText = '';
  let selectedPath = '';
  let selectedLens = 'default';
  const currentStoryLevel = () => Number(document.body.dataset.storyLevel ?? 1);
  const setActiveView = (view, viewButton) => { document.querySelectorAll('[data-view]').forEach((node) => node.classList.toggle('active', node === viewButton)); document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === view)); const zoomControls = document.querySelector('.story-zoom-controls'); if (zoomControls) zoomControls.hidden = view !== 'trailer' && view !== 'timeline' && view !== 'tests'; };

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
    if (questionButton) { const menu = byId('selection-menu'); delete menu.dataset.pressed; const question = questionButton.getAttribute('data-question') || window.prompt('What would you like to understand about these lines?'); if (question && selectedText) await submitQuestion(question); else menu.hidden = true; return; }
    const action = target.closest('[data-action]')?.getAttribute('data-action');
    if (action === 'export') { downloadReview(); toast('Review exported as an HTML file.'); return; }
    if (action === 'copy-summary') { copyPrompt(summaryPrompt(), 'Summary prompt copied for Codex.'); return; }
    if (action === 'settings') { toast('Lens and zoom preferences are saved locally.'); }
  });

  byId('lens-select').addEventListener('change', (event) => { selectedLens = event.target.value; byId('lens-notice').hidden = false; });
  document.addEventListener('selectionchange', () => { const selection = window.getSelection(); const menu = byId('selection-menu'); const anchor = selection && !selection.isCollapsed ? selection.anchorNode : null; const anchorElement = anchor ? (anchor instanceof Element ? anchor : anchor.parentElement) : null; const evidence = anchorElement ? anchorElement.closest('.evidence') : null; const text = evidence ? selection.toString().trim() : ''; if (!text) { if (menu.dataset.pressed !== 'true') menu.hidden = true; return; } selectedText = text; selectedPath = evidence.querySelector('.evidence-path')?.textContent?.trim() || ''; const rect = selection.getRangeAt(0).getBoundingClientRect(); menu.style.left = Math.max(8, rect.left) + 'px'; menu.style.top = Math.max(8, rect.top - 42) + 'px'; menu.hidden = false; });
  async function submitQuestion(question) { byId('selection-menu').hidden = true; toast('Grounding an answer in the selected evidence…'); try { await api('/api/revision/' + state.revisionId + '/questions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selection: selectedText, question }) }); await loadQuestions(); toast('Added an evidence-grounded note.'); } catch (error) { toast(error.message); } }
  function openChapter(chapter, open) { if (!chapter) return; chapter.classList.toggle('open', open); chapter.querySelector('.chapter-detail').hidden = !open; chapter.querySelector('.chapter-toggle').setAttribute('aria-expanded', String(open)); }
  function downloadReview() { const blob = new Blob(['<!doctype html>\\n' + document.documentElement.outerHTML], { type: 'text/html' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = document.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.html'; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  function copyPrompt(text, successMessage) { const write = navigator.clipboard?.writeText?.(text); if (write && typeof write.then === 'function') { write.then(() => toast(successMessage)).catch(() => showManualCopy(text)); return; } showManualCopy(text); }
  function showManualCopy(text) { window.prompt('Copy this prompt for Codex:', text); toast('Copy prompt shown for Codex.'); }
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
  let selectedPath = '';
  const currentStoryLevel = () => Number(document.body.dataset.storyLevel ?? 1);
  const setActiveView = (view, viewButton) => { document.querySelectorAll('[data-view]').forEach((node) => node.classList.toggle('active', node === viewButton)); document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === view)); const zoomControls = document.querySelector('.story-zoom-controls'); if (zoomControls) zoomControls.hidden = view !== 'trailer' && view !== 'timeline' && view !== 'tests'; };
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const viewButton = target.closest('[data-view]');
    if (viewButton) { setActiveView(viewButton.getAttribute('data-view'), viewButton); return; }
    const chapterButton = target.closest('.chapter-toggle');
    if (chapterButton) { if (currentStoryLevel() <= 1) return; const chapter = chapterButton.closest('.chapter'); openChapter(chapter, !chapter.classList.contains('open')); return; }
    const askButton = target.closest('[data-question], [data-action="ask"]');
    if (askButton) { const menu = byId('selection-menu'); menu.hidden = true; delete menu.dataset.pressed; if (!selectedText) return; const question = askButton.getAttribute('data-question') || window.prompt('What should Codex explain about the selected lines?'); if (question) copyPrompt(selectionPrompt(question), 'Prompt copied — paste it into Codex to continue.'); return; }
    const action = target.closest('[data-action]')?.getAttribute('data-action');
    if (action === 'export') { downloadReview(); toast('Review exported as an HTML file.'); return; }
    if (action === 'copy-summary') { copyPrompt(summaryPrompt(), 'Summary prompt copied for Codex.'); return; }
    if (action === 'settings') toast('This portable artifact has no server-backed settings.');
  });
  document.addEventListener('selectionchange', () => { const selection = window.getSelection(); const menu = byId('selection-menu'); const anchor = selection && !selection.isCollapsed ? selection.anchorNode : null; const anchorElement = anchor ? (anchor instanceof Element ? anchor : anchor.parentElement) : null; const evidence = anchorElement ? anchorElement.closest('.evidence') : null; const text = evidence ? selection.toString().trim() : ''; if (!text) { if (menu.dataset.pressed !== 'true') menu.hidden = true; return; } selectedText = text; selectedPath = evidence.querySelector('.evidence-path')?.textContent?.trim() || ''; const rect = selection.getRangeAt(0).getBoundingClientRect(); menu.style.left = Math.max(8, rect.left) + 'px'; menu.style.top = Math.max(8, rect.top - 42) + 'px'; menu.hidden = false; });
  function openChapter(chapter, open) { if (!chapter) return; chapter.classList.toggle('open', open); chapter.querySelector('.chapter-detail').hidden = !open; chapter.querySelector('.chapter-toggle').setAttribute('aria-expanded', String(open)); }
  function downloadReview() { const blob = new Blob(['<!doctype html>\\n' + document.documentElement.outerHTML], { type: 'text/html' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = document.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.html'; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  function copyPrompt(text, successMessage) { const write = navigator.clipboard?.writeText?.(text); if (write && typeof write.then === 'function') { write.then(() => toast(successMessage)).catch(() => showManualCopy(text)); return; } showManualCopy(text); }
  function showManualCopy(text) { window.prompt('Copy this prompt for Codex:', text); toast('Copy prompt shown for Codex.'); }
  function summaryPrompt() { const story = document.querySelector('#trailer')?.innerText?.trim() || document.querySelector('.main')?.innerText?.trim() || document.title; return 'Use this ndrstnd review summary to help me understand the implementation, decisions, risks, and tests.\\n\\n' + story; }
  function selectionPrompt(question) { const subject = document.title.replace(/^ndrstnd · /, ''); return question + '\\n\\nContext: ndrstnd review of ' + subject + (selectedPath ? '; selected excerpt from ' + selectedPath : '') + '.\\n\\nSelected lines:\\n' + selectedText; }
})();
`;

export const portableEnhancements = `
(() => {
  const byId = (id) => document.getElementById(id);
  const storyLevels = [{ name: 'Map', description: 'Themes and risk distribution' }, { name: 'Summary', description: 'Story claims and summaries' }, { name: 'Explanation', description: 'Before and after meaning' }, { name: 'Evidence', description: 'Focused code excerpts' }, { name: 'Raw', description: 'Complete change evidence' }];
  const timelineLevels = [{ name: 'Map', description: 'Complete build path' }, { name: 'Summary', description: 'Goals and postconditions' }, { name: 'Explanation', description: 'Deferred concerns and forward references' }, { name: 'Evidence', description: 'Cumulative evidence by step' }, { name: 'Raw', description: 'Cumulative patch through this step' }];
  const testLevels = [{ name: 'Map', description: 'Change themes and test activity' }, { name: 'Summary', description: 'Tested behaviors' }, { name: 'Explanation', description: 'Behavior meaning' }, { name: 'Evidence', description: 'Test cases and excerpts' }, { name: 'Raw', description: 'Complete test artifacts' }];
  const activeView = () => document.querySelector('[data-view].active')?.getAttribute('data-view') || 'trailer';
  const levelsForView = () => activeView() === 'tests' ? testLevels : activeView() === 'timeline' ? timelineLevels : storyLevels;
  const updateZoomLabel = (level) => {
    const levels = levelsForView();
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = levels[level].name;
    const description = document.getElementById('zoom-description');
    if (description) description.textContent = levels[level].description;
  };
  const ensureRawEvidence = (article) => {
    if (!article || article.querySelector('.raw-code')) return;
    const source = document.querySelector('#diff [data-diff-hunk="' + article.getAttribute('data-evidence-id') + '"] pre');
    if (!source) return;
    const raw = document.createElement('pre');
    raw.className = 'raw-code';
    raw.innerHTML = source.innerHTML;
    article.appendChild(raw);
  };
  const materializeEvidenceStack = (stack) => {
    if (!stack || stack.dataset.materialized === 'true' || stack.dataset.evidenceList === undefined) return;
    stack.dataset.evidenceList.split(' ').filter(Boolean).forEach((id) => { const template = document.querySelector('[data-evidence-template="' + id + '"]'); if (template) stack.appendChild(template.content.cloneNode(true)); });
    stack.dataset.materialized = 'true';
    if (Number(document.body.dataset.storyLevel ?? 1) >= 4) stack.querySelectorAll('.evidence[data-evidence-id]').forEach((article) => ensureRawEvidence(article));
  };
  const setChapterDetail = (chapter, expanded, animate) => { const detail = chapter.querySelector('.chapter-detail'); if (!detail) return; window.clearTimeout(Number(detail.dataset.zoomCollapseTimer)); if (expanded) { detail.hidden = false; materializeEvidenceStack(detail.querySelector('.evidence-stack')); if (animate) void detail.offsetHeight; chapter.classList.add('open'); detail.classList.toggle('zoom-revealed', animate); return; } chapter.classList.remove('open'); detail.classList.remove('zoom-revealed'); if (!animate) { detail.hidden = true; return; } detail.dataset.zoomCollapseTimer = String(window.setTimeout(() => { if (!chapter.classList.contains('open')) detail.hidden = true; }, 260)); };
  const setZoom = (level) => { level = Math.max(0, Math.min(4, level)); const current = Number(document.body.dataset.storyLevel ?? 1); const changed = current !== level; const zoom = document.getElementById('zoom-control'); zoom?.classList.toggle('is-changing', changed); document.body.dataset.storyLevel = String(level); document.body.className = document.body.className.replace(/story-level-\\d/g, '') + ' story-level-' + level; document.querySelectorAll('[data-zoom]').forEach((button) => { const active = Number(button.dataset.zoom) === level; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); updateZoomLabel(level); const callout = document.getElementById('zoom-callout'); if (callout) { callout.style.setProperty('--zoom-position', String(level / 4)); callout.dataset.edge = level === 0 ? 'start' : level === 4 ? 'end' : ''; } const map = document.getElementById('map'); if (map) map.hidden = level !== 0; document.querySelectorAll('.chapter').forEach((chapter) => setChapterDetail(chapter, level >= 2, changed)); if (level >= 4) document.querySelectorAll('.evidence[data-evidence-id]').forEach((article) => ensureRawEvidence(article)); if (changed) window.setTimeout(() => zoom?.classList.remove('is-changing'), 260); };
  setZoom(1);
  const setZoomControlsVisible = (view) => { const hidden = view !== 'trailer' && view !== 'timeline' && view !== 'tests'; const controls = document.querySelector('.story-zoom-controls'); if (controls) controls.hidden = hidden; document.querySelector('.view-bar')?.classList.toggle('view-bar-empty', hidden); updateZoomLabel(Number(document.body.dataset.storyLevel ?? 1)); };
  setZoomControlsVisible(document.querySelector('[data-view].active')?.getAttribute('data-view') || 'trailer');
  const materializeTimelineState = (state) => {
    if (!state || state.dataset.materialized === 'true') return;
    const evidence = state.querySelector('.timeline-evidence');
    if (!evidence || evidence.dataset.currentEvidence === undefined) return;
    const current = evidence.dataset.currentEvidence.split(' ').filter(Boolean);
    const prior = (evidence.dataset.priorEvidence || '').split(' ').filter(Boolean);
    const append = (id, isCurrent) => { const template = document.querySelector('[data-evidence-template="' + id + '"]'); if (!template) return; const item = document.createElement('div'); item.className = 'timeline-evidence-item' + (isCurrent ? ' current' : ''); item.setAttribute('data-evidence-id', id); item.appendChild(template.content.cloneNode(true)); evidence.appendChild(item); };
    current.forEach((id) => append(id, true));
    if (prior.length > 0) { const divider = document.createElement('p'); divider.className = 'timeline-evidence-divider'; divider.textContent = 'Already in place from earlier steps'; evidence.appendChild(divider); prior.forEach((id) => append(id, false)); }
    const raw = state.querySelector('.timeline-raw');
    if (raw) { const wanted = new Set(current.concat(prior)); document.querySelectorAll('#diff details.full-diff-file').forEach((file) => { const blocks = [...file.querySelectorAll('[data-diff-hunk]')].filter((block) => wanted.has(block.getAttribute('data-diff-hunk'))); if (blocks.length === 0) return; const copy = document.createElement('details'); copy.className = file.className; copy.open = true; const summary = file.querySelector('summary'); if (summary) copy.appendChild(summary.cloneNode(true)); blocks.forEach((block) => copy.appendChild(block.cloneNode(true))); raw.appendChild(copy); }); }
    if (Number(document.body.dataset.storyLevel ?? 1) >= 4) state.querySelectorAll('.evidence[data-evidence-id]').forEach((article) => ensureRawEvidence(article));
    state.dataset.materialized = 'true';
  };
  const clearTimelineState = (state) => {
    if (!state || state.dataset.materialized !== 'true') return;
    const evidence = state.querySelector('.timeline-evidence');
    if (evidence) evidence.replaceChildren();
    const raw = state.querySelector('.timeline-raw');
    if (raw) raw.replaceChildren();
    state.dataset.materialized = 'false';
  };
  materializeTimelineState(document.querySelector('.timeline-state.active'));
  const selectTimelineStep = (stepId) => { document.querySelectorAll('[data-timeline-state]').forEach((state) => { const active = state.getAttribute('data-timeline-state') === stepId; state.classList.toggle('active', active); state.hidden = !active; if (active) materializeTimelineState(state); else clearTimelineState(state); }); document.querySelectorAll('[data-timeline-select]').forEach((button) => { const active = button.getAttribute('data-timeline-select') === stepId; button.classList.toggle('active', active); if (button.getAttribute('role') === 'tab') button.setAttribute('aria-selected', String(active)); }); const ticks = [...document.querySelectorAll('.rail-tick')]; const index = ticks.findIndex((tick) => tick.getAttribute('data-timeline-select') === stepId); if (index < 0) return; const pad = (value) => String(value).padStart(2, '0'); const stepOutput = byId('rail-step'); if (stepOutput) stepOutput.textContent = pad(index + 1) + ' / ' + pad(ticks.length); const titleOutput = byId('rail-title'); if (titleOutput) titleOutput.textContent = ticks[index].getAttribute('data-step-title') || ''; document.querySelectorAll('[data-timeline-move]').forEach((nav) => { const next = index + Number(nav.getAttribute('data-timeline-move')); nav.toggleAttribute('disabled', next < 0 || next >= ticks.length); }); };
  const moveTimelineStep = (delta) => { const ticks = [...document.querySelectorAll('.rail-tick')]; const index = ticks.findIndex((tick) => tick.classList.contains('active')); const next = ticks[index + delta]; if (next) selectTimelineStep(next.getAttribute('data-timeline-select')); };
  const openStoryChapter = (id) => { document.querySelector('[data-view="trailer"]')?.click(); const chapter = document.querySelector('.chapter[data-chapter="' + id + '"]'); if (chapter) { setZoom(Math.max(2, Number(document.body.dataset.storyLevel ?? 1))); chapter.classList.add('open'); const detail = chapter.querySelector('.chapter-detail'); detail.hidden = false; materializeEvidenceStack(detail.querySelector('.evidence-stack')); chapter.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
  document.addEventListener('click', (event) => { const target = event.target instanceof Element ? event.target : null; if (!target) return; if (!target.closest('.selection-menu') && !target.closest('.evidence')) byId('selection-menu').hidden = true; const more = target.closest('.evidence-more'); if (more) { const article = more.closest('.evidence'); ensureRawEvidence(article); article?.classList.toggle('expanded'); return; } const chapterToggle = target.closest('.chapter-toggle'); if (chapterToggle) { const detail = chapterToggle.closest('.chapter')?.querySelector('.chapter-detail'); if (detail && !detail.hidden) materializeEvidenceStack(detail.querySelector('.evidence-stack')); } const timelineMove = target.closest('[data-timeline-move]'); if (timelineMove) { moveTimelineStep(Number(timelineMove.getAttribute('data-timeline-move'))); return; } const timelineSelect = target.closest('[data-timeline-select]'); if (timelineSelect) { selectTimelineStep(timelineSelect.getAttribute('data-timeline-select')); if (Number(document.body.dataset.storyLevel ?? 1) === 0) setZoom(1); return; } const storyStep = target.closest('[data-story-step]'); if (storyStep) { document.querySelector('[data-view="timeline"]')?.click(); selectTimelineStep(storyStep.getAttribute('data-story-step')); setZoom(Math.max(1, Number(document.body.dataset.storyLevel ?? 1))); document.querySelector('.timeline-rail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; } const storyStepIndex = target.closest('[data-story-step-index]'); if (storyStepIndex) { const index = Number(storyStepIndex.getAttribute('data-story-step-index')); const state = document.querySelector('.timeline-state[data-step-index="' + index + '"]'); document.querySelector('[data-view="timeline"]')?.click(); if (state) selectTimelineStep(state.getAttribute('data-timeline-state')); setZoom(3); document.querySelector('.timeline-rail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; } const collapse = target.closest('.collapse-sidebar'); if (collapse) { document.querySelector('.sidebar')?.classList.toggle('collapsed'); return; } const all = target.closest('#collapse-all'); if (all) { document.querySelectorAll('.chapter').forEach((chapter) => { chapter.classList.remove('open'); chapter.querySelector('.chapter-detail').hidden = true; }); return; } const testJump = target.closest('[data-test-jump]'); if (testJump) { const id = testJump.getAttribute('data-test-jump'); setZoom(3); window.setTimeout(() => { const card = document.querySelector('.test-plan-evidence [data-test-case="' + id + '"]'); if (card) { card.open = true; card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 0); return; } const chapterJump = target.closest('[data-step-chapter]'); if (chapterJump) { openStoryChapter(chapterJump.getAttribute('data-step-chapter')); return; } const view = target.closest('[data-view]')?.getAttribute('data-view'); if (view) setZoomControlsVisible(view); const step = target.closest('[data-zoom-step]'); if (step) { const active = Number(document.querySelector('[data-zoom].active')?.getAttribute('data-zoom') ?? 1); setZoom(active + Number(step.getAttribute('data-zoom-step'))); return; } if (target.closest('.zoom-info')) { document.getElementById('zoom-dialog').showModal(); return; } if (target.closest('[data-close-dialog]')) { document.getElementById('zoom-dialog').close(); return; } const zoom = target.closest('[data-zoom]'); if (zoom) setZoom(Number(zoom.getAttribute('data-zoom'))); });
  const selectionMenu = byId('selection-menu');
  if (selectionMenu) {
    selectionMenu.addEventListener('mousedown', (event) => event.preventDefault());
    selectionMenu.addEventListener('touchstart', () => { selectionMenu.dataset.pressed = 'true'; window.setTimeout(() => { delete selectionMenu.dataset.pressed; }, 700); }, { passive: true });
    const dismissSelectionMenu = () => { selectionMenu.hidden = true; };
    window.addEventListener('scroll', dismissSelectionMenu, { capture: true, passive: true });
    window.addEventListener('resize', dismissSelectionMenu, { passive: true });
  }
})();
(() => {
  const shell = document.querySelector('.app-shell');
  const bar = document.querySelector('.view-bar');
  const masthead = document.querySelector('.page-header');
  if (bar && masthead && typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => { bar.classList.toggle('view-bar-stuck', entries[0].boundingClientRect.top < 1); }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] }).observe(masthead);
  }
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (shell?.classList.contains('mobile-inspector-open') && window.innerWidth <= 1080 && !target.closest('.inspector') && !target.closest('.mobile-inspector-toggle')) {
      shell.classList.remove('mobile-inspector-open');
      document.querySelector('.mobile-inspector-toggle')?.setAttribute('aria-expanded', 'false');
      return;
    }
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
    if (window.innerWidth <= 1080) {
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
    if (target.closest('.collapse-inspector') && window.innerWidth > 1080) savePreferences({ inspectorCollapsed: shell?.classList.contains('inspector-collapsed') ?? false });
  });
})();
`;
