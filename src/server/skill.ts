import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function bundledSkillDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../src/skill-assets/ndrstnd");
}

function installedSkillDirectory(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills", "ndrstnd");
}

/** True when a skill is installed but its SKILL.md differs from the bundled one, meaning Codex follows outdated instructions. */
export async function installedSkillIsStale(): Promise<boolean> {
  try {
    const [bundled, installed] = await Promise.all([
      readFile(join(bundledSkillDirectory(), "SKILL.md"), "utf8"),
      readFile(join(installedSkillDirectory(), "SKILL.md"), "utf8"),
    ]);
    return bundled !== installed;
  } catch {
    return false;
  }
}

export async function installSkill(force = false): Promise<string> {
  const source = bundledSkillDirectory();
  const destination = installedSkillDirectory();
  try {
    await stat(destination);
    if (!force) throw new Error(`ndrstnd skill already exists at ${destination}. Re-run with --force to replace it.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
  return destination;
}
