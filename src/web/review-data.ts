import type { AnalysisDocument } from "../shared/analysis-schema.js";
import type { ChangedFile, DiffHunk } from "../shared/domain.js";

/**
 * The complete, serializable input to the static review presentation.
 *
 * Keeping this independent of the review store means a fixture can render the
 * exact same artifact while visual work is in progress.
 */
export interface ReviewPresentationData {
  sessionId: string;
  revisionId: string;
  targetRef: string;
  baseRef: string;
  mergeBase: string;
  files: ChangedFile[];
  hunks: DiffHunk[];
  document: AnalysisDocument;
}
