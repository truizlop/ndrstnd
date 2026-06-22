import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installSkill } from "../src/server/skill.js";

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
    await expect(readFile(join(destination, "SKILL.md"), "utf8")).resolves.toContain("evidence-led ndrstnd workspace");
  });
});
