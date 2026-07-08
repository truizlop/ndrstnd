/* Records the landing-page demo video segments with Playwright.
   Usage: node demo/record.mjs [segment…]   (default: all segments)
   Segments land in demo/out/<name>.webm; demo/build-videos.sh edits them into site/media. */
import { mkdir, readFile, rename } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, "..");
const outDir = resolve(root, "out");
const SIZE = { width: 1600, height: 1000 };

/* Serve the repo over HTTP so framing pages and the artifact iframe share an origin. */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    const data = await readFile(join(repoRoot, path));
    res.setHeader("content-type", MIME[extname(path)] ?? "application/octet-stream");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;

const framePage = (name) => `${base}/demo/frames/${name}.html`;
const artifactPage = (name) => `${base}/.ndrstnd/${name}.html`;

async function record(browser, name, url, drive) {
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: outDir, size: SIZE } });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[${name}] page error:`, error));
  await page.goto(url, { waitUntil: "load" });
  await page.addStyleTag({ content: "::-webkit-scrollbar{display:none} html{scrollbar-width:none}" });
  await drive(page);
  const video = page.video();
  await context.close();
  await rename(await video.path(), resolve(outDir, `${name}.webm`));
  console.log(`recorded ${name}.webm`);
}

const playFrame = async (page) => {
  await page.waitForTimeout(350);
  await page.evaluate(() => window.play());
  await page.waitForTimeout(400);
};

/* Moves the visual cursor to an element, pulses the click ring, then sends a real click. */
async function cursorClick(page, selector, moveMs = 700) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.evaluate(([x, y, ms]) => window.__cursor.moveTo(x, y, ms), [cx, cy, moveMs]);
  await page.evaluate(() => window.__cursor.press());
  await page.mouse.click(cx, cy);
}

const driveArtifact = async (page) => {
  await page.addScriptTag({ path: resolve(root, "frames", "cursor.js") });
  const hold = (ms) => page.waitForTimeout(ms);
  const scroll = (top) => page.evaluate((delta) => window.scrollBy({ top: delta, behavior: "smooth" }), top);

  await hold(1700);
  await page.evaluate(() => window.__cursor.show(1050, 620));

  // Story: expand the high-attention chapter, then walk the zoom dial.
  await cursorClick(page, '[data-chapter="idempotency-keys"] .chapter-toggle');
  await hold(2300);
  await cursorClick(page, '[data-zoom="0"]', 800);
  await hold(2000);
  await cursorClick(page, '[data-zoom="2"]', 550);
  await hold(2200);
  await cursorClick(page, '[data-zoom="3"]', 550);
  await hold(1400);
  await scroll(620);
  await hold(2000);

  // Timeline: step through the build path.
  await cursorClick(page, '.nav-item[data-view="timeline"]', 900);
  await hold(1600);
  for (let step = 0; step < 3; step += 1) {
    await cursorClick(page, '[data-timeline-move="1"]', step === 0 ? 700 : 350);
    await hold(1450);
  }

  // Test plan, then the full diff.
  await cursorClick(page, '.nav-item[data-view="tests"]', 800);
  await hold(1800);
  await scroll(540);
  await hold(1700);
  await cursorClick(page, '.nav-item[data-view="diff"]', 800);
  await hold(1500);
  await scroll(700);
  await hold(1600);

  // Close on the Story.
  await cursorClick(page, '.nav-item[data-view="trailer"]', 800);
  await page.evaluate(() => window.__cursor.hide());
  await hold(1500);
};

const segments = {
  "codex-frame": () => [framePage("codex"), playFrame],
  "claude-frame": () => [framePage("claude"), playFrame],
  "artifact-codex": () => [artifactPage("demo-codex"), driveArtifact],
  "artifact-claude": () => [artifactPage("demo-claude"), driveArtifact],
  endcard: () => [framePage("endcard"), playFrame],
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(segments);
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
for (const name of wanted) {
  if (!segments[name]) throw new Error(`unknown segment: ${name}`);
  const [url, drive] = segments[name]();
  await record(browser, name, url, drive);
}
await browser.close();
server.close();
