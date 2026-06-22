export type RiskCategory =
  | "formatting"
  | "refactor"
  | "behavior"
  | "performance"
  | "security";

export type Attention = "low" | "contained" | "elevated" | "high" | "critical";

export type ZoomLevel = 0 | 1 | 2 | 3 | 4;

export interface ReviewSession {
  id: string;
  repoPath: string;
  targetRef: string;
  mergeBase: string;
}

export type DiffLineKind = "context" | "addition" | "deletion";

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  id: string;
  fileId: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export type FileSignal = "meaningful" | "low-signal";

export interface ChangedFile {
  id: string;
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown";
  binary: boolean;
  signal: FileSignal;
  signalReason?: string;
}
