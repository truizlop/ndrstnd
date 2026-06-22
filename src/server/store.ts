import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { ConversationContext } from "./conversation.js";
import type { AnalysisDocument } from "../shared/analysis-schema.js";
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
  source: "fallback" | "codex";
  document: AnalysisDocument;
  createdAt: string;
}

export interface ReviewLens { id: string; name: string; instructions: string; builtIn: boolean; }
export interface QuestionCard { id: string; revisionId: string; selection: string; question: string; answer?: string; provenance?: "branch" | "conversation" | "both" | "general"; createdAt: string; }

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
      CREATE TABLE IF NOT EXISTS analysis_lens (id TEXT PRIMARY KEY, name TEXT NOT NULL, instructions TEXT NOT NULL, built_in INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS preference (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS question_card (id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES analysis_revision(id), selection TEXT NOT NULL, question TEXT NOT NULL, answer TEXT, provenance TEXT, created_at TEXT NOT NULL);
    `);
    const columns = this.database.prepare("PRAGMA table_info(review_session)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "conversation_json")) {
      this.database.exec("ALTER TABLE review_session ADD COLUMN conversation_json TEXT");
    }
    const insertLens = this.database.prepare("INSERT OR IGNORE INTO analysis_lens (id, name, instructions, built_in) VALUES (?, ?, ?, 1)");
    for (const lens of builtInLenses) insertLens.run(lens.id, lens.name, lens.instructions);
  }

  getOrCreateSession(input: CollectedReviewInput, conversation?: ConversationContext): StoredReviewSession {
    const inputHash = hashInput(input, conversation);
    const existing = this.database.prepare("SELECT * FROM review_session WHERE input_hash = ?").get(inputHash) as SessionRow | undefined;
    if (existing !== undefined) return deserialize(existing);

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
    this.database.prepare(`
      INSERT INTO review_session (id, repo_path, target_ref, base_ref, merge_base, input_hash, input_json, conversation_json, created_at)
      VALUES (@id, @repoPath, @targetRef, @baseRef, @mergeBase, @inputHash, @inputJson, @conversationJson, @createdAt)
    `).run({ ...session, inputJson: JSON.stringify(input), conversationJson: conversation === undefined ? null : JSON.stringify(conversation) });
    return session;
  }

  getSession(id: string): StoredReviewSession | undefined {
    const row = this.database.prepare("SELECT * FROM review_session WHERE id = ?").get(id) as SessionRow | undefined;
    return row === undefined ? undefined : deserialize(row);
  }

  createRevision(sessionId: string, source: AnalysisRevision["source"], status: AnalysisRevision["status"], document: AnalysisDocument): AnalysisRevision {
    const revision: AnalysisRevision = { id: randomUUID(), sessionId, source, status, document, createdAt: new Date().toISOString() };
    this.database.prepare(`
      INSERT INTO analysis_revision (id, session_id, status, source, document_json, created_at)
      VALUES (@id, @sessionId, @status, @source, @documentJson, @createdAt)
    `).run({ ...revision, documentJson: JSON.stringify(document) });
    return revision;
  }

  listRevisions(sessionId: string): AnalysisRevision[] {
    const rows = this.database.prepare("SELECT * FROM analysis_revision WHERE session_id = ? ORDER BY created_at DESC").all(sessionId) as RevisionRow[];
    return rows.map((row) => ({ id: row.id, sessionId: row.session_id, status: row.status as AnalysisRevision["status"], source: row.source as AnalysisRevision["source"], document: JSON.parse(row.document_json) as AnalysisDocument, createdAt: row.created_at }));
  }

  listLenses(): ReviewLens[] {
    return (this.database.prepare("SELECT * FROM analysis_lens ORDER BY built_in DESC, name").all() as LensRow[]).map((row) => ({ id: row.id, name: row.name, instructions: row.instructions, builtIn: row.built_in === 1 }));
  }

  getLens(id: string): ReviewLens | undefined {
    const row = this.database.prepare("SELECT * FROM analysis_lens WHERE id = ?").get(id) as LensRow | undefined;
    return row === undefined ? undefined : { id: row.id, name: row.name, instructions: row.instructions, builtIn: row.built_in === 1 };
  }

  setPreference(key: string, value: string): void {
    this.database.prepare("INSERT INTO preference (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  getPreference(key: string): string | undefined {
    return (this.database.prepare("SELECT value FROM preference WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }

  createQuestion(revisionId: string, selection: string, question: string): QuestionCard {
    const card: QuestionCard = { id: randomUUID(), revisionId, selection, question, createdAt: new Date().toISOString() };
    this.database.prepare("INSERT INTO question_card (id, revision_id, selection, question, created_at) VALUES (@id, @revisionId, @selection, @question, @createdAt)").run(card);
    return card;
  }

  answerQuestion(id: string, answer: string, provenance: NonNullable<QuestionCard["provenance"]>): void {
    this.database.prepare("UPDATE question_card SET answer = ?, provenance = ? WHERE id = ?").run(answer, provenance, id);
  }

  listQuestions(revisionId: string): QuestionCard[] {
    return (this.database.prepare("SELECT * FROM question_card WHERE revision_id = ? ORDER BY created_at").all(revisionId) as QuestionRow[]).map((row) => ({ id: row.id, revisionId: row.revision_id, selection: row.selection, question: row.question, answer: row.answer ?? undefined, provenance: row.provenance as QuestionCard["provenance"], createdAt: row.created_at }));
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
  created_at: string;
}
interface LensRow { id: string; name: string; instructions: string; built_in: number; }
interface QuestionRow { id: string; revision_id: string; selection: string; question: string; answer: string | null; provenance: string | null; created_at: string; }

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

const builtInLenses: ReviewLens[] = [
  { id: "default", name: "Default", instructions: "Prioritize the implementation story and behavior changes.", builtIn: true },
  { id: "security", name: "Security", instructions: "Elevate trust boundaries, authorization, secrets, and input validation.", builtIn: true },
  { id: "performance", name: "Performance", instructions: "Elevate hot paths, allocations, data volume, and concurrency.", builtIn: true },
  { id: "api", name: "API compatibility", instructions: "Elevate public contracts, schema changes, and callers.", builtIn: true },
  { id: "migrations", name: "Data migrations", instructions: "Elevate persistence, migration, and backward compatibility effects.", builtIn: true },
  { id: "tests", name: "Test coverage", instructions: "Elevate behavior that needs demonstrable test coverage.", builtIn: true },
];

function defaultDatabasePath(): string {
  if (process.env.NDRSTND_DATA_DIR !== undefined) return join(process.env.NDRSTND_DATA_DIR, "ndrstnd.sqlite");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "ndrstnd", "ndrstnd.sqlite");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? homedir(), "ndrstnd", "ndrstnd.sqlite");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "ndrstnd", "ndrstnd.sqlite");
}
