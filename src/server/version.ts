import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

/** The version shipped in package.json, so --version and agent handshakes can never drift from the release. */
export async function packageVersion(): Promise<string> {
  if (cached === undefined) {
    const manifest = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8")) as { version?: string };
    cached = manifest.version ?? "unknown";
  }
  return cached;
}
