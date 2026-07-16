import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeAgent, codexAgent, hostAgent, piAgent, resolveReviewAgent } from "../src/server/agent.js";

describe("resolveReviewAgent", () => {
  const previousPath = process.env.PATH;
  // Tests themselves run inside an agent's shell, so its host markers must be
  // saved and cleared for the resolution tests to be deterministic.
  const previousEnv = new Map(["NDRSTND_AGENT", "PI_CODING_AGENT", "CLAUDECODE", "CODEX_SANDBOX"].map((key) => [key, process.env[key]]));
  let scratch: string | undefined;

  const clearHostMarkers = () => {
    delete process.env.PI_CODING_AGENT;
    delete process.env.CLAUDECODE;
    delete process.env.CODEX_SANDBOX;
  };

  afterEach(async () => {
    process.env.PATH = previousPath;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  });

  it("honors an explicit agent id and rejects unknown ones", async () => {
    await expect(resolveReviewAgent("codex")).resolves.toBe(codexAgent);
    await expect(resolveReviewAgent("claude")).resolves.toBe(claudeAgent);
    await expect(resolveReviewAgent("pi")).resolves.toBe(piAgent);
    await expect(resolveReviewAgent("copilot")).rejects.toThrow("Unknown analysis agent: copilot. Supported agents: codex, claude, pi.");
  });

  it("falls back to NDRSTND_AGENT when no agent is passed", async () => {
    process.env.NDRSTND_AGENT = "claude";
    await expect(resolveReviewAgent()).resolves.toBe(claudeAgent);
  });

  it("auto-detects the only installed CLI and defaults to Codex otherwise", async () => {
    delete process.env.NDRSTND_AGENT;
    clearHostMarkers();
    scratch = await mkdtemp(join(tmpdir(), "ndrstnd-agent-"));
    process.env.PATH = scratch;
    await expect(resolveReviewAgent()).resolves.toBe(codexAgent);

    await writeFile(join(scratch, "claude"), "#!/bin/sh\n");
    await chmod(join(scratch, "claude"), 0o755);
    await expect(resolveReviewAgent()).resolves.toBe(claudeAgent);

    await rm(join(scratch, "claude"));
    await writeFile(join(scratch, "pi"), "#!/bin/sh\n");
    await chmod(join(scratch, "pi"), 0o755);
    await expect(resolveReviewAgent()).resolves.toBe(piAgent);

    await writeFile(join(scratch, "codex"), "#!/bin/sh\n");
    await chmod(join(scratch, "codex"), 0o755);
    await expect(resolveReviewAgent()).resolves.toBe(codexAgent);
  });

  it("detects the agent hosting the process from its shell markers", () => {
    expect(hostAgent({ PI_CODING_AGENT: "true" })).toBe(piAgent);
    expect(hostAgent({ CLAUDECODE: "1" })).toBe(claudeAgent);
    expect(hostAgent({ CODEX_SANDBOX: "seatbelt" })).toBe(codexAgent);
    expect(hostAgent({ PI_CODING_AGENT: "true", CLAUDECODE: "1", CODEX_SANDBOX: "seatbelt" })).toBe(piAgent);
    // Claude Code marks every shell it runs, so it is the innermost host when Pi is absent.
    expect(hostAgent({ CLAUDECODE: "1", CODEX_SANDBOX: "seatbelt" })).toBe(claudeAgent);
    expect(hostAgent({})).toBeUndefined();
    expect(hostAgent({ PI_CODING_AGENT: "", CLAUDECODE: "", CODEX_SANDBOX: "" })).toBeUndefined();
  });

  it("prefers the host agent over installed CLIs, but NDRSTND_AGENT over the host", async () => {
    delete process.env.NDRSTND_AGENT;
    clearHostMarkers();
    scratch = await mkdtemp(join(tmpdir(), "ndrstnd-agent-"));
    await writeFile(join(scratch, "codex"), "#!/bin/sh\n");
    await chmod(join(scratch, "codex"), 0o755);
    process.env.PATH = scratch;

    process.env.CLAUDECODE = "1";
    await expect(resolveReviewAgent()).resolves.toBe(claudeAgent);

    process.env.NDRSTND_AGENT = "codex";
    await expect(resolveReviewAgent()).resolves.toBe(codexAgent);
  });

  it("names the login command and home directory for each agent", () => {
    expect([codexAgent.command, ...codexAgent.loginArgs]).toEqual(["codex", "login"]);
    expect([claudeAgent.command, ...claudeAgent.loginArgs]).toEqual(["claude", "auth", "login"]);
    expect([piAgent.command, ...piAgent.loginArgs]).toEqual(["pi"]);
    expect(piAgent.loginInstructions).toContain("Run /login");
    const previousHome = process.env.CLAUDE_CONFIG_DIR;
    const previousPiHome = process.env.PI_CODING_AGENT_DIR;
    process.env.CLAUDE_CONFIG_DIR = "/tmp/claude-config";
    process.env.PI_CODING_AGENT_DIR = "/tmp/pi-config";
    expect(claudeAgent.homeDirectory()).toBe("/tmp/claude-config");
    expect(piAgent.homeDirectory()).toBe("/tmp/pi-config");
    if (previousHome === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousHome;
    if (previousPiHome === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousPiHome;
  });
});
