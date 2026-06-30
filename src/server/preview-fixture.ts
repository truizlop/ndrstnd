import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { frozenReviewData } from "../web/frozen-review-data.js";
import { renderArtifact } from "../web/page.js";

const artifactPath = resolve(process.cwd(), ".ndrstnd", "frozen-review.html");
await mkdir(join(process.cwd(), ".ndrstnd"), { recursive: true, mode: 0o700 });
await writeFile(artifactPath, await renderArtifact(frozenReviewData), { encoding: "utf8", mode: 0o600 });
await chmod(artifactPath, 0o600);
process.stdout.write(`ndrstnd frozen fixture: ${artifactPath}\n`);

if (!process.argv.includes("--no-open")) await openBrowser(artifactPath);

async function openBrowser(path: string): Promise<void> {
  const command: [string, string[]] = process.platform === "darwin" ? ["open", [path]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", path]] : ["xdg-open", [path]];
  try {
    await promisify(execFile)(command[0], command[1]);
  } catch {
    process.stdout.write("Could not open a browser automatically. Open the file path above.\n");
  }
}
