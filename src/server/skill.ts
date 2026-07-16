import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewAgents, reviewAgentById, type ReviewAgent, type ReviewAgentId } from "./agent.js";

function bundledSkillDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../src/skill-assets/ndrstnd");
}

function installedSkillDirectory(agent: ReviewAgent): string {
  return join(agent.homeDirectory(), "skills", "ndrstnd");
}

/** True when any installed skill differs from the bundled one in any file, meaning that agent follows outdated instructions or assets. */
export async function installedSkillIsStale(): Promise<boolean> {
  for (const agent of reviewAgents) {
    const destination = installedSkillDirectory(agent);
    if (!(await exists(destination))) continue;
    try {
      const [bundled, installed] = await Promise.all([skillFiles(bundledSkillDirectory()), skillFiles(destination)]);
      if (bundled.size !== installed.size) return true;
      for (const [path, content] of bundled) {
        if (installed.get(path) !== content) return true;
      }
    } catch {
      // An unreadable installation is reported at install time, not on every review.
    }
  }
  return false;
}

async function skillFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const childRelative = join(relative, entry.name);
      if (entry.isDirectory()) await walk(childRelative);
      else files.set(childRelative, await readFile(join(root, childRelative), "utf8"));
    }
  };
  await walk(".");
  return files;
}

export interface SkillInstallation {
  agent: ReviewAgent;
  destination: string;
  status: "installed" | "skipped";
  reason?: string;
}

/**
 * Installs the bundled skill for the requested agent, or for every agent whose
 * configuration directory exists when none is requested explicitly.
 */
export async function installSkill(force = false, agentId?: ReviewAgentId): Promise<SkillInstallation[]> {
  const source = bundledSkillDirectory();
  const targets = agentId === undefined ? await detectedAgents() : [requireAgent(agentId)];
  if (targets.length === 0) {
    throw new Error(`No supported agent is set up: none of ${reviewAgents.map((agent) => agent.homeDirectory()).join(", ")} exists. Install one of ${reviewAgents.map((agent) => agent.name).join(", ")} first, or pass --agent to choose one explicitly.`);
  }
  const installations: SkillInstallation[] = [];
  for (const agent of targets) {
    const destination = installedSkillDirectory(agent);
    if (!force && await exists(destination)) {
      installations.push({ agent, destination, status: "skipped", reason: `the ndrstnd skill already exists at ${destination}; re-run with --force to replace it` });
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    // A merge-copy would leave files a newer release removed; replace the installation wholesale.
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true, force: true });
    installations.push({ agent, destination, status: "installed" });
  }
  return installations;
}

function requireAgent(agentId: ReviewAgentId): ReviewAgent {
  const agent = reviewAgentById(agentId);
  if (agent === undefined) throw new Error(`Unknown analysis agent: ${agentId}.`);
  return agent;
}

async function detectedAgents(): Promise<ReviewAgent[]> {
  const detected: ReviewAgent[] = [];
  for (const agent of reviewAgents) {
    if (await exists(agent.homeDirectory())) detected.push(agent);
  }
  return detected;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
