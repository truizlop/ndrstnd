import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installSkill, installedSkillIsStale } from "../src/server/skill.js";

describe("installSkill", () => {
  let home: string | undefined;
  const previous = process.env.CODEX_HOME;

  afterEach(async () => {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
    if (home !== undefined) await rm(home, { recursive: true, force: true });
  });

  it("installs the bundled Codex skill into CODEX_HOME", async () => {
    home = await mkdtemp(join(tmpdir(), "ndrstnd-skill-"));
    process.env.CODEX_HOME = home;
    const destination = await installSkill();
    const skill = await readFile(join(destination, "SKILL.md"), "utf8");
    expect(skill).toContain("evidence-led ndrstnd workspace");
    expect(skill).toContain("ndrstnd review --uncommitted");
    expect(skill).toContain("Export the conversation unless it contains no intent.");
  });

  it("detects when the installed skill drifts from the bundled one", async () => {
    home = await mkdtemp(join(tmpdir(), "ndrstnd-skill-"));
    process.env.CODEX_HOME = home;
    expect(await installedSkillIsStale()).toBe(false);
    const destination = await installSkill();
    expect(await installedSkillIsStale()).toBe(false);
    await writeFile(join(destination, "SKILL.md"), "outdated instructions");
    expect(await installedSkillIsStale()).toBe(true);
  });
});
