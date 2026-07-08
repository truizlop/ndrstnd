import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkill, installedSkillIsStale } from "../src/server/skill.js";

describe("installSkill", () => {
  let codexHome: string;
  let claudeHome: string;
  const previousCodexHome = process.env.CODEX_HOME;
  const previousClaudeHome = process.env.CLAUDE_CONFIG_DIR;

  beforeEach(async () => {
    // Both agent homes must point at temp directories so tests never touch a real installation.
    codexHome = await mkdtemp(join(tmpdir(), "ndrstnd-skill-codex-"));
    claudeHome = await mkdtemp(join(tmpdir(), "ndrstnd-skill-claude-"));
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
  });

  afterEach(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousClaudeHome === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeHome;
    await rm(codexHome, { recursive: true, force: true });
    await rm(claudeHome, { recursive: true, force: true });
  });

  it("installs the bundled skill for every agent whose home exists", async () => {
    const installations = await installSkill();
    expect(installations.map((installation) => [installation.agent.id, installation.status])).toEqual([["codex", "installed"], ["claude", "installed"]]);
    for (const installation of installations) {
      const skill = await readFile(join(installation.destination, "SKILL.md"), "utf8");
      expect(skill).toContain("evidence-led ndrstnd workspace");
      expect(skill).toContain("ndrstnd review --uncommitted");
      expect(skill).toContain("Export the conversation unless it contains no intent.");
      expect(skill).toContain('"help me understand these changes"');
      expect(skill).toContain("heartbeat");
      expect(skill).toContain("never kill or restart it mid-analysis");
      expect(skill).toContain("`codex` for Codex, `claude` for Claude Code");
    }
    expect(installations[0].destination).toBe(join(codexHome, "skills", "ndrstnd"));
    expect(installations[1].destination).toBe(join(claudeHome, "skills", "ndrstnd"));
  });

  it("only targets agents that are set up when none is requested explicitly", async () => {
    await rm(claudeHome, { recursive: true, force: true });
    const installations = await installSkill();
    expect(installations.map((installation) => installation.agent.id)).toEqual(["codex"]);
  });

  it("fails when no agent is set up instead of guessing a destination", async () => {
    await rm(codexHome, { recursive: true, force: true });
    await rm(claudeHome, { recursive: true, force: true });
    await expect(installSkill()).rejects.toThrow("No supported agent is set up");
  });

  it("installs for an explicitly requested agent even before its first detection", async () => {
    await rm(claudeHome, { recursive: true, force: true });
    const installations = await installSkill(false, "claude");
    expect(installations).toHaveLength(1);
    expect(installations[0].status).toBe("installed");
    expect(installations[0].destination).toBe(join(claudeHome, "skills", "ndrstnd"));
  });

  it("skips an existing installation unless forced", async () => {
    await mkdir(join(claudeHome, "skills", "ndrstnd"), { recursive: true });
    await writeFile(join(claudeHome, "skills", "ndrstnd", "SKILL.md"), "hand-edited");
    const installations = await installSkill();
    expect(installations.find((installation) => installation.agent.id === "claude")?.status).toBe("skipped");
    expect(installations.find((installation) => installation.agent.id === "claude")?.reason).toContain("--force");
    expect(installations.find((installation) => installation.agent.id === "codex")?.status).toBe("installed");

    const forced = await installSkill(true);
    expect(forced.every((installation) => installation.status === "installed")).toBe(true);
    expect(await readFile(join(claudeHome, "skills", "ndrstnd", "SKILL.md"), "utf8")).toContain("evidence-led ndrstnd workspace");
  });

  it("detects when any installed skill drifts from the bundled one", async () => {
    expect(await installedSkillIsStale()).toBe(false);
    const installations = await installSkill();
    expect(await installedSkillIsStale()).toBe(false);
    const claudeInstallation = installations.find((installation) => installation.agent.id === "claude");
    await writeFile(join(claudeInstallation!.destination, "SKILL.md"), "outdated instructions");
    expect(await installedSkillIsStale()).toBe(true);
  });
});
