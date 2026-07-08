import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderArtifact } from "../src/web/page.js";
import { demoReviewData } from "./review-data.js";

/** Renders the landing-demo review once per agent so the recorded artifact names the agent that "produced" it. */
const variants = [
  { file: "demo-codex.html", agentName: "Codex", targetRef: "codex/checkout-retry-hardening" },
  { file: "demo-claude.html", agentName: "Claude Code", targetRef: "claude/checkout-retry-hardening" },
];

const outDir = resolve(process.cwd(), ".ndrstnd");
await mkdir(outDir, { recursive: true, mode: 0o700 });
for (const variant of variants) {
  const html = await renderArtifact({ ...demoReviewData, agentName: variant.agentName, targetRef: variant.targetRef });
  const path = join(outDir, variant.file);
  await writeFile(path, html, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${path}\n`);
}
