import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AnalysisRevision, StoredReviewSession } from "./store.js";
import { renderArtifact } from "../web/page.js";

const artifactPrefix = "ndrstnd-";
const maxArtifactAgeMs = 7 * 24 * 60 * 60 * 1000;

export interface ArtifactOptions {
  directory?: string;
  now?: Date;
}

export async function writeReviewArtifact(session: StoredReviewSession, revision: AnalysisRevision, options: ArtifactOptions = {}): Promise<string> {
  const directory = options.directory ?? defaultArtifactDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await cleanupArtifacts(directory, options.now);
  const timestamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const filePath = join(directory, `${artifactPrefix}${timestamp}-${revision.id.slice(0, 8)}.html`);
  await writeFile(filePath, renderArtifact(session, revision), { encoding: "utf8", mode: 0o600 });
  return filePath;
}

export async function cleanupArtifacts(directory = defaultArtifactDirectory(), now = new Date()): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await Promise.all(entries.filter((entry) => entry.startsWith(artifactPrefix) && entry.endsWith(".html")).map(async (entry) => {
    const path = join(directory, entry);
    const metadata = await stat(path);
    if (now.getTime() - metadata.mtime.getTime() > maxArtifactAgeMs) await rm(path, { force: true });
  }));
}

export function defaultArtifactDirectory(): string {
  if (process.env.NDRSTND_ARTIFACT_DIR !== undefined) return process.env.NDRSTND_ARTIFACT_DIR;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "ndrstnd", "artifacts");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? homedir(), "ndrstnd", "artifacts");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "ndrstnd", "artifacts");
}
