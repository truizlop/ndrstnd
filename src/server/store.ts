import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { ConversationContext } from "./conversation.js";
import { ANALYSIS_DOCUMENT_VERSION, AnalysisDocumentSchema, type AnalysisDocument } from "../shared/analysis-schema.js";
import type { CollectedReviewInput } from "./git.js";

export interface StoredReviewSession {
  id: string;
  repoPath: string;
  targetRef: string;
  baseRef: string;
  mergeBase: string;
  inputHash: string;
  input: CollectedReviewInput;
  conversation?: ConversationContext;
  createdAt: string;
}

export interface AnalysisRevision {
  id: string;
  sessionId: string;
  status: "partial" | "complete" | "failed";
  // "fallback" only survives in databases written before fallback analysis was removed.
  source: "fallback" | "codex" | "claude";
  document: AnalysisDocument;
  createdAt: string;
}

/** True for revisions produced by a real analysis agent, excluding legacy fallback rows. */
export function isAgentRevision(revision: AnalysisRevision): boolean {
  return revision.source !== "fallback";
}

export class ReviewStore {
  private readonly database: Database.Database;

  constructor(databasePath = defaultDatabasePath()) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS review_session (
        id TEXT PRIMARY KEY,
        repo_path TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        merge_base TEXT NOT NULL,
        input_hash TEXT NOT NULL UNIQUE,
        input_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analysis_revision (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES review_session(id),
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        document_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const columns = this.database.prepare("PRAGMA table_info(review_session)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "conversation_json")) {
      this.database.exec("ALTER TABLE review_session ADD COLUMN conversation_json TEXT");
    }
    const revisionColumns = this.database.prepare("PRAGMA table_info(analysis_revision)").all() as Array<{ name: string }>;
    if (!revisionColumns.some((column) => column.name === "document_version")) {
      this.database.exec("ALTER TABLE analysis_revision ADD COLUMN document_version INTEGER");
    }
  }

  getOrCreateSession(input: CollectedReviewInput, conversation?: ConversationContext): StoredReviewSession {
    const inputHash = hashInput(input, conversation);
    const session: StoredReviewSession = {
      id: randomUUID(),
      repoPath: input.repoPath,
      targetRef: input.targetRef,
      baseRef: input.baseRef,
      mergeBase: input.mergeBase,
      inputHash,
      input,
      conversation,
      createdAt: new Date().toISOString(),
    };
    // Insert-then-select keeps concurrent reviews of the same input from racing a separate existence check into a UNIQUE violation.
    this.database.prepare(`
      INSERT INTO review_session (id, repo_path, target_ref, base_ref, merge_base, input_hash, input_json, conversation_json, created_at)
      VALUES (@id, @repoPath, @targetRef, @baseRef, @mergeBase, @inputHash, @inputJson, @conversationJson, @createdAt)
      ON CONFLICT(input_hash) DO NOTHING
    `).run({ ...session, inputJson: JSON.stringify(input), conversationJson: conversation === undefined ? null : JSON.stringify(conversation) });
    const row = this.database.prepare("SELECT * FROM review_session WHERE input_hash = ?").get(inputHash) as SessionRow;
    return deserialize(row);
  }

  getSession(id: string): StoredReviewSession | undefined {
    const row = this.database.prepare("SELECT * FROM review_session WHERE id = ?").get(id) as SessionRow | undefined;
    return row === undefined ? undefined : deserialize(row);
  }

  createRevision(sessionId: string, source: AnalysisRevision["source"], status: AnalysisRevision["status"], document: AnalysisDocument): AnalysisRevision {
    const revision: AnalysisRevision = { id: randomUUID(), sessionId, source, status, document, createdAt: new Date().toISOString() };
    this.database.prepare(`
      INSERT INTO analysis_revision (id, session_id, status, source, document_json, document_version, created_at)
      VALUES (@id, @sessionId, @status, @source, @documentJson, @documentVersion, @createdAt)
    `).run({ ...revision, documentJson: JSON.stringify(document), documentVersion: ANALYSIS_DOCUMENT_VERSION });
    return revision;
  }

  /** Rows written for another document version, or whose stored document no longer validates, read as absent so the caller re-analyzes instead of rendering a broken artifact. */
  listRevisions(sessionId: string): AnalysisRevision[] {
    const rows = this.database.prepare("SELECT * FROM analysis_revision WHERE session_id = ? ORDER BY created_at DESC").all(sessionId) as RevisionRow[];
    return rows.flatMap((row) => {
      if (row.document_version !== null && row.document_version !== ANALYSIS_DOCUMENT_VERSION) return [];
      const document = parseStoredDocument(row.document_json);
      if (document === undefined) return [];
      return [{ id: row.id, sessionId: row.session_id, status: row.status as AnalysisRevision["status"], source: row.source as AnalysisRevision["source"], document, createdAt: row.created_at }];
    });
  }

  close(): void {
    this.database.close();
  }
}

interface RevisionRow {
  id: string;
  session_id: string;
  status: string;
  source: string;
  document_json: string;
  document_version: number | null;
  created_at: string;
}

function parseStoredDocument(documentJson: string): AnalysisDocument | undefined {
  try {
    const parsed = AnalysisDocumentSchema.safeParse(JSON.parse(documentJson));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
interface SessionRow {
  id: string;
  repo_path: string;
  target_ref: string;
  base_ref: string;
  merge_base: string;
  input_hash: string;
  input_json: string;
  conversation_json: string | null;
  created_at: string;
}

function deserialize(row: SessionRow): StoredReviewSession {
  return {
    id: row.id,
    repoPath: row.repo_path,
    targetRef: row.target_ref,
    baseRef: row.base_ref,
    mergeBase: row.merge_base,
    inputHash: row.input_hash,
    input: JSON.parse(row.input_json) as CollectedReviewInput,
    conversation: row.conversation_json === null ? undefined : JSON.parse(row.conversation_json) as ConversationContext,
    createdAt: row.created_at,
  };
}

function hashInput(input: CollectedReviewInput, conversation?: ConversationContext): string {
  return createHash("sha256").update(JSON.stringify({ input, conversation })).digest("hex");
}

function defaultDatabasePath(): string {
  if (process.env.NDRSTND_DATA_DIR !== undefined) return join(process.env.NDRSTND_DATA_DIR, "ndrstnd.sqlite");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "ndrstnd", "ndrstnd.sqlite");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? homedir(), "ndrstnd", "ndrstnd.sqlite");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "ndrstnd", "ndrstnd.sqlite");
}
