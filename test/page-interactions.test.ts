import { Window } from "happy-dom";
import { expect, it } from "vitest";
import { artifactClientScript, portableEnhancements } from "../src/web/page.js";

it("changes the portable Story surface at every zoom level with staged expansion and collapse", async () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<button data-view="trailer" class="nav-item active"></button><button data-view="timeline" class="nav-item"></button><button data-view="diff" class="nav-item"></button><button data-view="tests" class="nav-item"></button><section id="trailer" class="view active"></section><section id="timeline" class="view"></section><section id="diff" class="view"></section><section id="tests" class="view"></section><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div><button data-zoom-step="1"></button></div><div id="selection-menu" hidden></div><article class="chapter"><button class="chapter-toggle"></button><div class="chapter-detail" hidden><div class="evidence-stack"></div></div></article>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);
  const cases = [
    [0, "Map", "Themes and risk distribution", false],
    [1, "Summary", "Story claims and summaries", false],
    [2, "Explanation", "Before and after meaning", true],
    [3, "Evidence", "Focused code excerpts", true],
    [4, "Raw", "Complete change evidence", true],
  ] as const;

  for (const [level, label, description, expanded] of cases) {
    document.querySelector<HTMLElement>(`[data-zoom="${level}"]`)?.click();
    expect([...document.body.classList].filter((name) => name.startsWith("story-level-"))).toEqual([`story-level-${level}`]);
    expect(document.querySelector("#zoom-label")?.textContent).toBe(label);
    expect(document.querySelector("#zoom-description")?.textContent).toBe(description);
    expect(document.querySelector<HTMLElement>("#zoom-callout")?.style.getPropertyValue("--zoom-position")).toBe(String(level / 4));
    expect(document.querySelector<HTMLElement>("#zoom-callout")?.dataset.edge).toBe(level === 0 ? "start" : level === 4 ? "end" : "");
    expect(document.querySelector<HTMLElement>(`[data-zoom="${level}"]`)?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".chapter")?.classList.contains("open")).toBe(expanded);
    expect(document.querySelector(".chapter-toggle")?.getAttribute("aria-expanded")).toBe(String(expanded));
    expect(document.querySelector<HTMLElement>("#map")?.hidden).toBe(level !== 0);
  }

  document.querySelector<HTMLElement>('[data-zoom="1"]')?.click();
  document.querySelector<HTMLElement>(".chapter-toggle")?.click();
  expect(document.querySelector(".chapter")?.classList.contains("open")).toBe(false);
  expect(document.querySelector<HTMLElement>(".chapter-detail")?.hidden).toBe(false);
  await new Promise((resolve) => window.setTimeout(resolve, 280));
  expect(document.querySelector<HTMLElement>(".chapter-detail")?.hidden).toBe(true);

  document.querySelector<HTMLElement>('[data-zoom="0"]')?.click();
  document.querySelector<HTMLElement>(".chapter-toggle")?.click();
  expect(document.querySelector(".chapter")?.classList.contains("open")).toBe(false);

  const zoomVisibilityByView: Record<string, boolean | undefined> = {};
  for (const view of ["timeline", "diff", "tests", "trailer"]) {
    document.querySelector<HTMLElement>(`[data-view="${view}"]`)?.click();
    zoomVisibilityByView[view] = document.querySelector<HTMLElement>(".story-zoom-controls")?.hidden;
  }
  expect(zoomVisibilityByView).toMatchInlineSnapshot(`
    {
      "diff": true,
      "tests": false,
      "timeline": false,
      "trailer": false,
    }
  `);
  expect(document.querySelector<HTMLElement>(".story-zoom-controls")?.hidden).toBe(false);
});

it("uses the shared zoom rail on Test plan and jumps from behavior summary to evidence", async () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<button data-view="trailer" class="nav-item active"></button><button data-view="tests" class="nav-item"></button><section id="trailer" class="view active"></section><section id="tests" class="view"><article class="test-behavior"><button data-test-jump="case-1"></button></article><div class="test-plan-evidence"><details data-test-case="case-1"></details></div></section><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div></div><div id="selection-menu" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  document.querySelector<HTMLElement>('[data-view="tests"]')?.click();
  expect(document.querySelector<HTMLElement>(".story-zoom-controls")?.hidden).toBe(false);
  expect(document.querySelector("#zoom-description")?.textContent).toBe("Tested behaviors");

  document.querySelector<HTMLElement>('[data-test-jump="case-1"]')?.click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  expect(document.body.dataset.storyLevel).toBe("3");
  expect(document.querySelector("#zoom-description")?.textContent).toBe("Test cases and excerpts");
  expect(document.querySelector<HTMLDetailsElement>('[data-test-case="case-1"]')?.open).toBe(true);
});

it("restores non-Story views with the zoom controls hidden", () => {
  const window = new Window({ url: "http://127.0.0.1:3000/" });
  const document = window.document;
  window.localStorage.setItem("ndrstnd-artifact-ui-preferences-v1", JSON.stringify({ zoom: 4, view: "diff" }));
  document.body.innerHTML = `<button data-view="trailer" class="nav-item active"></button><button data-view="timeline" class="nav-item"></button><button data-view="diff" class="nav-item"></button><button data-view="tests" class="nav-item"></button><section id="trailer" class="view active"></section><section id="timeline" class="view"></section><section id="diff" class="view"></section><section id="tests" class="view"></section><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div></div><div id="selection-menu" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  expect({
    activeView: [...document.querySelectorAll(".view.active")].map((node) => node.id),
    storyLevel: document.body.dataset.storyLevel,
    zoomHidden: document.querySelector<HTMLElement>(".story-zoom-controls")?.hidden,
  }).toMatchInlineSnapshot(`
    {
      "activeView": [
        "diff",
      ],
      "storyLevel": "4",
      "zoomHidden": true,
    }
  `);
});

it("uses the shared zoom rail on Timeline and changes its semantic level labels", () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<button data-view="trailer" class="nav-item active"></button><button data-view="timeline" class="nav-item"></button><section id="trailer" class="view active"></section><section id="timeline" class="view"><div class="timeline-map"></div><div class="timeline-summary"></div><div class="timeline-explanation"></div><div class="timeline-evidence"></div><div class="timeline-raw"></div></section><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div></div><div id="selection-menu" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  document.querySelector<HTMLElement>('[data-view="timeline"]')?.click();
  expect(document.querySelector<HTMLElement>(".story-zoom-controls")?.hidden).toBe(false);
  const labels = [0, 1, 2, 3, 4].map((level) => {
    document.querySelector<HTMLElement>(`[data-zoom="${level}"]`)?.click();
    return {
      level,
      bodyClass: [...document.body.classList].find((name) => name.startsWith("story-level-")),
      label: document.querySelector("#zoom-label")?.textContent,
      description: document.querySelector("#zoom-description")?.textContent,
    };
  });

  expect(labels).toEqual([
    { level: 0, bodyClass: "story-level-0", label: "Map", description: "Complete build path" },
    { level: 1, bodyClass: "story-level-1", label: "Summary", description: "Goals and postconditions" },
    { level: 2, bodyClass: "story-level-2", label: "Explanation", description: "Deferred concerns and forward references" },
    { level: 3, bodyClass: "story-level-3", label: "Evidence", description: "Cumulative evidence by step" },
    { level: 4, bodyClass: "story-level-4", label: "Raw", description: "Cumulative patch through this step" },
  ]);
});

it("jumps between Timeline steps and Story chapters in the portable artifact", () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<button data-view="trailer" class="nav-item active"></button><button data-view="timeline" class="nav-item"></button><section id="trailer" class="view active"><article class="chapter" data-chapter="chapter-1"><button class="chapter-toggle"><span data-story-step="step-02"></span></button><div class="chapter-detail" hidden></div></article></section><section id="timeline" class="view"><button data-timeline-select="step-01" role="tab"></button><button data-timeline-select="step-02" role="tab"></button><article class="timeline-state active" data-timeline-state="step-01" data-step-index="1"></article><article class="timeline-state" data-timeline-state="step-02" data-step-index="2" hidden><button data-step-chapter="chapter-1"></button></article></section><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div></div><div id="selection-menu" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  document.querySelector<HTMLElement>('[data-story-step="step-02"]')?.click();
  expect(document.querySelector("#timeline")?.classList.contains("active")).toBe(true);
  expect(document.querySelector<HTMLElement>('[data-timeline-state="step-02"]')?.hidden).toBe(false);
  expect(document.querySelector('[data-timeline-select="step-02"]')?.classList.contains("active")).toBe(true);

  document.querySelector<HTMLElement>('[data-step-chapter="chapter-1"]')?.click();
  expect(document.querySelector("#trailer")?.classList.contains("active")).toBe(true);
  expect(document.querySelector(".chapter")?.classList.contains("open")).toBe(true);
  expect(document.querySelector<HTMLElement>(".chapter-detail")?.hidden).toBe(false);
});

it("toggles chapters from the keyboard and keeps step chips from flipping the chapter", () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<button data-view="trailer" class="nav-item active"></button><button data-view="timeline" class="nav-item"></button><section id="trailer" class="view active"><article class="chapter" data-chapter="chapter-1"><div class="chapter-toggle" role="button" tabindex="0" aria-expanded="false"><button type="button" class="step-chip" data-story-step="step-01">step 01</button></div><div class="chapter-detail" hidden></div></article></section><section id="timeline" class="view"><button data-timeline-select="step-01" role="tab"></button><article class="timeline-state active" data-timeline-state="step-01" data-step-index="1"></article></section><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div></div><div id="selection-menu" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);
  document.querySelector<HTMLElement>('[data-zoom="2"]')?.click();
  const toggle = document.querySelector<HTMLElement>(".chapter-toggle");
  expect(document.querySelector(".chapter")?.classList.contains("open")).toBe(true);

  toggle?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(document.querySelector(".chapter")?.classList.contains("open")).toBe(false);
  expect(toggle?.getAttribute("aria-expanded")).toBe("false");

  toggle?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(document.querySelector(".chapter")?.classList.contains("open")).toBe(true);
  expect(toggle?.getAttribute("aria-expanded")).toBe("true");

  document.querySelector<HTMLElement>(".step-chip")?.click();
  expect(document.querySelector("#timeline")?.classList.contains("active")).toBe(true);
  document.querySelector<HTMLElement>('[data-view="trailer"]')?.click();
  expect(document.querySelector(".chapter")?.classList.contains("open")).toBe(true);
});

it("materializes test excerpts from their templates when zoom reaches Evidence and Raw", () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<button data-view="trailer" class="nav-item active"></button><section id="trailer" class="view active"></section><section id="tests" class="view"><div class="test-plan-evidence"><details data-test-case="case-1"><div class="test-excerpt-slot" data-test-hunk="hunk-1"></div></details></div><div class="test-plan-raw"><div class="test-raw-slot" data-test-hunk="hunk-1"></div></div></section><section id="diff" class="view"><div data-diff-hunk="hunk-1"><pre><span class="line addition"><code>expect(ok).toBe(true);</code></span></pre></div></section><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div></div><div id="test-excerpt-library" hidden><template data-test-excerpt-template="hunk-1"><article class="evidence"><pre>focused excerpt</pre></article></template></div><div id="selection-menu" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  expect(document.querySelector(".test-excerpt-slot")?.innerHTML).toBe("");

  document.querySelector<HTMLElement>('[data-zoom="3"]')?.click();

  expect(document.querySelector(".test-excerpt-slot")?.textContent).toContain("focused excerpt");
  expect(document.querySelector(".test-raw-slot")?.textContent).toContain("expect(ok).toBe(true);");
});

it("opens a Story chapter whose id contains selector metacharacters", () => {
  const window = new Window();
  const document = window.document;
  const hostileId = 'quote"back\\slash';
  document.body.innerHTML = `<button data-view="trailer" class="nav-item active"></button><button data-view="timeline" class="nav-item"></button><section id="trailer" class="view active"><article class="chapter"><button class="chapter-toggle"></button><div class="chapter-detail" hidden></div></article></section><section id="timeline" class="view"><button data-step-chapter=""></button></section><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div></div><div id="selection-menu" hidden></div>`;
  document.querySelector(".chapter")?.setAttribute("data-chapter", hostileId);
  document.querySelector("[data-step-chapter]")?.setAttribute("data-step-chapter", hostileId);
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  document.querySelector<HTMLElement>("[data-step-chapter]")?.click();

  expect(document.querySelector("#trailer")?.classList.contains("active")).toBe(true);
  expect(document.querySelector(".chapter")?.classList.contains("open")).toBe(true);
  expect(document.querySelector<HTMLElement>(".chapter-detail")?.hidden).toBe(false);
});

it("restores the Test plan with zoom controls visible", () => {
  const window = new Window({ url: "http://127.0.0.1:3000/" });
  const document = window.document;
  window.localStorage.setItem("ndrstnd-artifact-ui-preferences-v1", JSON.stringify({ zoom: 2, view: "tests" }));
  document.body.innerHTML = `<button data-view="trailer" class="nav-item active"></button><button data-view="tests" class="nav-item"></button><section id="trailer" class="view active"></section><section id="tests" class="view"></section><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div></div><div id="selection-menu" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  expect(document.querySelector("#tests")?.classList.contains("active")).toBe(true);
  expect(document.body.dataset.storyLevel).toBe("2");
  expect(document.querySelector<HTMLElement>(".story-zoom-controls")?.hidden).toBe(false);
  expect(document.querySelector("#zoom-description")?.textContent).toBe("Behavior meaning");
});

it("sets zoom-level classes that select focused or raw evidence", () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<button data-view="trailer" class="nav-item active"></button><section id="trailer" class="view active"></section><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div></div><div id="selection-menu" hidden></div><article class="chapter"><button class="chapter-toggle"></button><div class="chapter-detail" hidden><div class="evidence-stack"><article class="evidence"><header><span class="focused-label"></span><span class="raw-label"></span></header><pre class="focused-code"></pre><pre class="raw-code"></pre><p class="evidence-context"></p></article></div></div></article>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);
  const states = [0, 1, 2, 3, 4].map((level) => {
    document.querySelector<HTMLElement>(`[data-zoom="${level}"]`)?.click();
    return {
      level,
      bodyClass: [...document.body.classList].find((name) => name.startsWith("story-level-")),
      expanded: document.querySelector(".chapter")?.classList.contains("open"),
      mapHidden: document.querySelector<HTMLElement>("#map")?.hidden,
      label: document.querySelector("#zoom-label")?.textContent,
    };
  });
  expect(states).toMatchInlineSnapshot(`
    [
      {
        "bodyClass": "story-level-0",
        "expanded": false,
        "label": "Map",
        "level": 0,
        "mapHidden": false,
      },
      {
        "bodyClass": "story-level-1",
        "expanded": false,
        "label": "Summary",
        "level": 1,
        "mapHidden": true,
      },
      {
        "bodyClass": "story-level-2",
        "expanded": true,
        "label": "Explanation",
        "level": 2,
        "mapHidden": true,
      },
      {
        "bodyClass": "story-level-3",
        "expanded": true,
        "label": "Evidence",
        "level": 3,
        "mapHidden": true,
      },
      {
        "bodyClass": "story-level-4",
        "expanded": true,
        "label": "Raw",
        "level": 4,
        "mapHidden": true,
      },
    ]
  `);
});

it("exports a portable review file from the inspector actions", () => {
  const window = new Window({ url: "http://127.0.0.1:3000/" });
  const document = window.document;
  const downloads: string[] = [];
  Object.defineProperty(window.URL, "createObjectURL", { configurable: true, value: () => "blob:review" });
  Object.defineProperty(window.URL, "revokeObjectURL", { configurable: true, value: () => undefined });
  document.title = "ndrstnd · agent-change";
  document.body.innerHTML = `<main class="main"><section id="trailer">Implementation story</section></main><button data-action="export"></button><button data-action="copy-summary"></button><div id="selection-menu" hidden></div><div id="toast" hidden></div>`;
  window.HTMLAnchorElement.prototype.click = function click() { downloads.push(this.download); };
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { downloads.push(value); } } });

  window.eval(`${artifactClientScript}`);
  document.querySelector<HTMLElement>('[data-action="export"]')?.click();
  expect(downloads).toContain("ndrstnd-agent-change.html");

  document.querySelector<HTMLElement>('[data-action="copy-summary"]')?.click();
  expect(downloads.at(-1)).toContain("Use this ndrstnd review summary");
});

it("shows the agent prompt manually when clipboard copy is denied", async () => {
  const window = new Window({ url: "http://127.0.0.1:3000/" });
  const document = window.document;
  const prompts: Array<{ message: string; value?: string }> = [];
  document.body.setAttribute("data-agent", "Codex");
  document.body.innerHTML = `<main class="main"><section id="trailer">Implementation story</section></main><button data-action="copy-summary"></button><div id="selection-menu" hidden></div><div id="toast" hidden></div>`;
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
  window.prompt = (message?: string, value?: string) => {
    prompts.push({ message: message ?? "", value });
    return null;
  };

  window.eval(`${artifactClientScript}`);
  document.querySelector<HTMLElement>('[data-action="copy-summary"]')?.click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  expect(prompts).toEqual([
    {
      message: "Copy this prompt for Codex:",
      value: expect.stringContaining("Use this ndrstnd review summary"),
    },
  ]);
  expect(document.querySelector("#toast")?.textContent).toBe("Copy prompt shown for Codex.");
});

it("collapses each desktop rail and opens the review details as a mobile sheet", () => {
  const window = new Window();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  const document = window.document;
  document.body.innerHTML = `<div class="app-shell"><aside class="sidebar"><button class="collapse-sidebar" aria-expanded="true"></button></aside><button class="mobile-inspector-toggle" aria-expanded="false"></button><aside class="inspector"><button class="collapse-inspector" aria-expanded="true"></button></aside></div><div id="map" hidden></div><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div><div id="selection-menu" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);
  const shell = document.querySelector(".app-shell")!;
  const sidebar = document.querySelector(".sidebar")!;

  document.querySelector<HTMLElement>(".collapse-sidebar")?.click();
  expect(sidebar.classList.contains("collapsed")).toBe(true);
  expect(shell.classList.contains("sidebar-collapsed")).toBe(true);

  document.querySelector<HTMLElement>(".collapse-inspector")?.click();
  expect(shell.classList.contains("inspector-collapsed")).toBe(true);

  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  document.querySelector<HTMLElement>(".mobile-inspector-toggle")?.click();
  expect(shell.classList.contains("mobile-inspector-open")).toBe(true);
  document.querySelector<HTMLElement>(".collapse-inspector")?.click();
  expect(shell.classList.contains("mobile-inspector-open")).toBe(false);

  // Collapsing the sidebar while the details sheet is open must dismiss the sheet and keep the shell grid and aria state in step.
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
  document.querySelector<HTMLElement>(".mobile-inspector-toggle")?.click();
  expect(shell.classList.contains("mobile-inspector-open")).toBe(true);
  document.querySelector<HTMLElement>(".collapse-sidebar")?.click();
  expect(shell.classList.contains("mobile-inspector-open")).toBe(false);
  expect(sidebar.classList.contains("collapsed")).toBe(false);
  expect(shell.classList.contains("sidebar-collapsed")).toBe(false);
  expect(document.querySelector(".collapse-sidebar")?.getAttribute("aria-expanded")).toBe("true");
});

it("restores and saves portable UI preferences when local storage is available", () => {
  const window = new Window({ url: "http://127.0.0.1:3000/" });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  const document = window.document;
  window.localStorage.setItem("ndrstnd-artifact-ui-preferences-v1", JSON.stringify({ sidebarCollapsed: true, inspectorCollapsed: true, zoom: 3, view: "timeline" }));
  document.body.innerHTML = `<div class="app-shell"><aside class="sidebar"><button class="collapse-sidebar" aria-expanded="true"></button></aside><button class="mobile-inspector-toggle" aria-expanded="false"></button><aside class="inspector"><button class="collapse-inspector" aria-expanded="true"></button></aside></div><button data-view="trailer" class="nav-item active"></button><button data-view="timeline" class="nav-item"></button><section id="trailer" class="view active"></section><section id="timeline" class="view"></section><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div></div><div id="selection-menu" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  expect(document.querySelector(".sidebar")?.classList.contains("collapsed")).toBe(true);
  expect(document.querySelector(".app-shell")?.classList.contains("inspector-collapsed")).toBe(true);
  expect(document.body.dataset.storyLevel).toBe("3");
  expect(document.querySelector("#timeline")?.classList.contains("active")).toBe(true);
  expect(document.querySelector<HTMLElement>(".story-zoom-controls")?.hidden).toBe(false);

  document.querySelector<HTMLElement>('[data-view="trailer"]')?.click();
  document.querySelector<HTMLElement>('[data-zoom="2"]')?.click();
  document.querySelector<HTMLElement>(".collapse-sidebar")?.click();
  document.querySelector<HTMLElement>(".collapse-inspector")?.click();
  expect(JSON.parse(window.localStorage.getItem("ndrstnd-artifact-ui-preferences-v1") || "{}")).toEqual({ sidebarCollapsed: false, inspectorCollapsed: false, zoom: 2, view: "trailer" });
});

it("materializes chapter evidence from the library and clones raw excerpts from the full diff", () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<button data-view="trailer" class="nav-item active"></button><section id="trailer" class="view active"><article class="chapter"><button class="chapter-toggle" aria-expanded="false"></button><div class="chapter-detail" hidden><div class="evidence-stack" data-evidence-list="h1"></div></div></article></section><section id="diff"><details class="file full-diff-file" open data-file-id="f"><summary><span class="file-path">src/a.ts</span></summary><div class="diff-block" data-diff-hunk="h1"><div class="diff-hunk-header">@@</div><pre><span class="line context">raw-line</span></pre></div></details></section><div id="evidence-library" hidden><template data-evidence-template="h1"><article class="evidence focused-evidence" data-evidence-id="h1"><pre class="focused-code">focused-line</pre></article></template></div><div id="map" hidden></div><div class="story-zoom-controls"><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div></div><div id="selection-menu" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  const stack = document.querySelector(".evidence-stack")!;
  expect(stack.children).toHaveLength(0);

  document.querySelector<HTMLElement>('[data-zoom="3"]')?.click();
  expect(stack.querySelector('[data-evidence-id="h1"]')).not.toBeNull();
  expect(stack.querySelector(".raw-code")).toBeNull();

  document.querySelector<HTMLElement>('[data-zoom="4"]')?.click();
  const raw = stack.querySelector(".raw-code");
  expect(raw).not.toBeNull();
  expect(raw?.textContent).toContain("raw-line");
});

it("materializes the active timeline step from the evidence library and clears inactive steps", () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<button data-view="timeline" class="nav-item active"></button><section id="timeline" class="view active"><button class="rail-tick active" data-timeline-select="step-01" data-step-title="one"></button><button class="rail-tick" data-timeline-select="step-02" data-step-title="two"></button><article class="timeline-state active" data-timeline-state="step-01" data-step-index="1"><div class="timeline-evidence" data-current-evidence="h1"></div><div class="timeline-raw"></div></article><article class="timeline-state" data-timeline-state="step-02" data-step-index="2" hidden><div class="timeline-evidence" data-current-evidence="h2"></div><div class="timeline-raw"></div></article></section><section id="diff"><details class="file full-diff-file" open data-file-id="f"><summary><span class="file-path">src/a.ts</span></summary><div class="diff-block" data-diff-hunk="h1"><pre>one</pre></div><div class="diff-block" data-diff-hunk="h2"><pre>two</pre></div></details></section><div id="evidence-library" hidden><template data-evidence-template="h1"><article class="evidence" data-evidence-id="h1"><pre>ev-one</pre></article></template><template data-evidence-template="h2"><article class="evidence" data-evidence-id="h2"><pre>ev-two</pre></article></template></div><div id="map" hidden></div><div id="selection-menu" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  const stateOne = document.querySelector('[data-timeline-state="step-01"]')!;
  expect(stateOne.querySelector('.timeline-evidence-item.current [data-evidence-id="h1"]')).not.toBeNull();
  expect(stateOne.querySelectorAll(".timeline-raw .diff-block")).toHaveLength(1);
  expect(stateOne.textContent).not.toContain("Already in place from earlier steps");

  document.querySelector<HTMLElement>('[data-timeline-select="step-02"]')?.click();
  const stateTwo = document.querySelector('[data-timeline-state="step-02"]')!;
  expect(stateTwo.querySelectorAll(".timeline-evidence-item")).toHaveLength(2);
  expect(stateTwo.querySelector('.timeline-evidence-item.current [data-evidence-id="h2"]')).not.toBeNull();
  expect(stateTwo.textContent).toContain("Already in place from earlier steps");
  expect(stateTwo.querySelectorAll(".timeline-raw .diff-block")).toHaveLength(2);
  expect(stateOne.querySelector(".timeline-evidence")!.children).toHaveLength(0);
  expect(stateOne.querySelector(".timeline-raw")!.children).toHaveLength(0);

  document.querySelector<HTMLElement>('[data-timeline-select="step-01"]')?.click();
  expect(stateOne.querySelector('[data-evidence-id="h1"]')).not.toBeNull();
});

const selectionFixture = `<article class="evidence"><header><span class="evidence-path">src/app.ts</span></header><pre class="focused-code">const answer = 42;</pre></article><div id="selection-menu" class="selection-menu" hidden><button data-question="Explain the selected lines.">Explain selection</button><button data-action="ask">Ask a question…</button></div><div id="toast" hidden></div>`;

const selectEvidence = (window: Window) => {
  const document = window.document;
  const textNode = document.querySelector(".focused-code")!.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 18);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));
  return selection;
};

it("copies an evidence-grounded agent prompt from the selection menu and confirms with a toast", async () => {
  const window = new Window({ url: "http://127.0.0.1:3000/" });
  const document = window.document;
  document.title = "ndrstnd · agent-change";
  const copies: string[] = [];
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copies.push(value); } } });
  document.body.setAttribute("data-agent", "Codex");
  document.body.innerHTML = selectionFixture;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  const menu = document.querySelector<HTMLElement>("#selection-menu")!;
  selectEvidence(window);
  expect(menu.hidden).toBe(false);

  document.querySelector<HTMLElement>("[data-question]")?.click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  expect(copies.at(-1)).toBe("Explain the selected lines.\n\nContext: ndrstnd review of agent-change; selected excerpt from src/app.ts.\n\nSelected lines:\nconst answer = 42;");
  expect(document.querySelector("#toast")?.textContent).toBe("Prompt copied. Paste it into Codex to continue.");
  expect(menu.hidden).toBe(true);

  selectEvidence(window);
  document.querySelector<HTMLElement>('[data-action="ask"]')?.click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  expect(copies.at(-1)).toBe("Context: ndrstnd review of agent-change; selected excerpt from src/app.ts.\n\nSelected lines:\nconst answer = 42;\n\nMy question: ");
  expect(document.querySelector("#toast")?.textContent).toBe("Selection copied. Paste it into Codex and add your question.");
  expect(menu.hidden).toBe(true);
});

it("shows the selection menu for Full diff selections with the file path", async () => {
  const window = new Window({ url: "http://127.0.0.1:3000/" });
  const document = window.document;
  document.title = "ndrstnd · agent-change";
  const copies: string[] = [];
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copies.push(value); } } });
  document.body.innerHTML = `<section id="diff"><details class="file full-diff-file" open data-file-id="f"><summary><span class="file-path">src/diffed.ts</span></summary><div class="diff-block" data-diff-hunk="h"><pre class="dcode">const patched = 1;</pre></div></details></section><div id="selection-menu" class="selection-menu" hidden><button data-question="Explain the selected lines.">Explain selection</button></div><div id="toast" hidden></div>`;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  const textNode = document.querySelector(".dcode")!.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 18);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));

  const menu = document.querySelector<HTMLElement>("#selection-menu")!;
  expect(menu.hidden).toBe(false);
  document.querySelector<HTMLElement>("[data-question]")?.click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  expect(copies.at(-1)).toContain("selected excerpt from src/diffed.ts");
  expect(copies.at(-1)).toContain("const patched = 1;");
});

it("keeps the selection menu hidden until the pointer is released", () => {
  const window = new Window({ url: "http://127.0.0.1:3000/" });
  const document = window.document;
  document.body.innerHTML = selectionFixture;
  window.eval(`${artifactClientScript}${portableEnhancements}`);
  const menu = document.querySelector<HTMLElement>("#selection-menu")!;

  document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  const textNode = document.querySelector(".focused-code")!.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 18);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));
  expect(menu.hidden).toBe(true);

  document.body.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
  expect(menu.hidden).toBe(false);
});

it("dismisses the selection menu on scroll and on deselection", () => {
  const window = new Window({ url: "http://127.0.0.1:3000/" });
  const document = window.document;
  document.body.innerHTML = selectionFixture;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  const menu = document.querySelector<HTMLElement>("#selection-menu")!;
  const selection = selectEvidence(window);
  expect(menu.hidden).toBe(false);

  document.querySelector(".focused-code")!.dispatchEvent(new window.Event("scroll"));
  expect(menu.hidden).toBe(true);

  document.dispatchEvent(new window.Event("selectionchange"));
  expect(menu.hidden).toBe(false);

  selection.removeAllRanges();
  document.dispatchEvent(new window.Event("selectionchange"));
  expect(menu.hidden).toBe(true);
});

it("keeps the selection menu actionable while a touch press collapses the selection", async () => {
  const window = new Window({ url: "http://127.0.0.1:3000/" });
  const document = window.document;
  document.title = "ndrstnd · agent-change";
  const copies: string[] = [];
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copies.push(value); } } });
  document.body.innerHTML = selectionFixture;
  window.eval(`${artifactClientScript}${portableEnhancements}`);

  const menu = document.querySelector<HTMLElement>("#selection-menu")!;
  const selection = selectEvidence(window);
  expect(menu.hidden).toBe(false);

  const press = new window.MouseEvent("mousedown", { cancelable: true, bubbles: true });
  menu.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);

  menu.dispatchEvent(new window.Event("touchstart"));
  selection.removeAllRanges();
  document.dispatchEvent(new window.Event("selectionchange"));
  expect(menu.hidden).toBe(false);

  document.querySelector<HTMLElement>("[data-question]")?.click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  expect(copies.at(-1)).toContain("const answer = 42;");
  expect(menu.hidden).toBe(true);
  expect(menu.dataset.pressed).toBeUndefined();
});
