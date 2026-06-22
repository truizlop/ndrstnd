import { cp, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function installSkill(force = false): Promise<string> {
  const source = join(dirname(fileURLToPath(import.meta.url)), "../../src/skill-assets/ndrstnd");
  const destination = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills", "ndrstnd");
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
