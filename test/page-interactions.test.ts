import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { artifactClientScript, clientScript, portableEnhancements } from "../src/web/page.js";

describe("ndrstnd workspace interactions", () => {
  it("switches views, expands chapters, changes zoom, and surfaces lens re-analysis", async () => {
    const window = new Window({ url: "http://127.0.0.1:3000/?token=test" });
    const document = window.document;
    document.body.innerHTML = `
      <button data-view="trailer" class="nav-item active"></button><button data-view="timeline" class="nav-item"></button>
      <section id="trailer" class="view active"></section><section id="timeline" class="view"></section>
      <div id="zoom"><button data-zoom="0"></button><button data-zoom="1"></button></div><div id="map" hidden></div>
      <select id="lens-select"></select><div id="lens-notice" hidden></div><button id="rerun"></button>
      <article class="chapter"><button class="chapter-toggle" aria-expanded="false"></button><div class="chapter-detail" hidden></div></article>
      <div id="selection-menu" hidden><button data-question="Explain"></button></div><div id="toast" hidden></div><div id="question-cards"></div>
    `;
    window.fetch = async (input: string) => ({
      ok: true,
      json: async () => input.includes("lenses") ? [{ id: "default", name: "Default" }] : input.includes("preferences") ? { zoom: 1 } : [],
    } as Response);
    window.eval(`const ndrstnd = ${JSON.stringify({ sessionId: "session", revisionId: "revision", token: "test" })};${clientScript}`);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    document.querySelector<HTMLElement>('[data-view="timeline"]')?.click();
    expect(document.querySelector("#timeline")?.classList.contains("active")).toBe(true);
    expect(document.querySelector("#trailer")?.classList.contains("active")).toBe(false);

    document.querySelector<HTMLElement>(".chapter-toggle")?.click();
    expect(document.querySelector(".chapter")?.classList.contains("open")).toBe(true);
    expect(document.querySelector<HTMLElement>(".chapter-detail")?.hidden).toBe(false);

    document.querySelector<HTMLElement>('[data-zoom="0"]')?.click();
    expect(document.querySelector<HTMLElement>("#map")?.hidden).toBe(false);

    const lens = document.querySelector<HTMLSelectElement>("#lens-select");
    lens!.value = "default";
    lens!.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(document.querySelector<HTMLElement>("#lens-notice")?.hidden).toBe(false);
  });
});

it("changes the portable Story surface at every zoom level with staged expansion and collapse", async () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<div id="map" hidden></div><div id="zoom-control"><div id="zoom-callout"><output id="zoom-label"></output><span id="zoom-description"></span></div><button data-zoom="0"></button><button data-zoom="1"></button><button data-zoom="2"></button><button data-zoom="3"></button><button data-zoom="4"></button></div><button data-zoom-step="1"></button><div id="selection-menu" hidden></div><article class="chapter"><button class="chapter-toggle"></button><div class="chapter-detail" hidden><div class="evidence-stack"></div></div></article>`;
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
    expect(document.querySelector<HTMLElement>("#map")?.hidden).toBe(level !== 0);
  }

  document.querySelector<HTMLElement>('[data-zoom="1"]')?.click();
  expect(document.querySelector(".chapter")?.classList.contains("open")).toBe(false);
  expect(document.querySelector<HTMLElement>(".chapter-detail")?.hidden).toBe(false);
  await new Promise((resolve) => window.setTimeout(resolve, 280));
  expect(document.querySelector<HTMLElement>(".chapter-detail")?.hidden).toBe(true);
});
