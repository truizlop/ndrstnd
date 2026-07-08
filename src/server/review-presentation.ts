import type { AnalysisRevision, StoredReviewSession } from "./store.js";
import type { ReviewPresentationData } from "../web/review-data.js";

export function createReviewPresentationData(session: StoredReviewSession, revision: AnalysisRevision): ReviewPresentationData {
  return {
    sessionId: session.id,
    revisionId: revision.id,
    targetRef: session.targetRef,
    baseRef: session.baseRef,
    mergeBase: session.mergeBase,
    files: session.input.files,
    hunks: session.input.hunks,
    document: revision.document,
    agentName: revision.source === "claude" ? "Claude Code" : "Codex",
  };
}
