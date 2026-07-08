import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", "src/server/cli.ts", ...args], { cwd: projectRoot, encoding: "utf8" });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "", code: failed.code ?? 1 };
  }
}

describe("ndrstnd CLI", () => {
  it("prints help and exits cleanly without arguments", async () => {
    const result = await runCli([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("understand agent-produced branch changes");
    expect(result.stdout).toContain("--fresh");
  });

  it("rejects unknown review options loudly", async () => {
    const result = await runCli(["review", "--nope"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown review option: --nope");
  });

  it("reports a missing repository path as a one-line error without a stack trace", async () => {
    const result = await runCli(["review", "--no-open", "--repo", "/does/not/exist"]);
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe("The repository path /does/not/exist does not exist.");
  });
}, 30_000);
