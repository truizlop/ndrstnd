import type { ReviewPresentationData } from "./review-data.js";

/** A stable, intentionally representative review for presentation and visual tests. */
export const frozenReviewData: ReviewPresentationData = {
  sessionId: "frozen-session",
  revisionId: "frozen-revision",
  targetRef: "frozen-ui-change",
  baseRef: "main",
  mergeBase: "a1b2c3d4e5f6",
  agentName: "Codex",
  files: [
    { id: "runner", path: "src/runner.ts", status: "modified", binary: false, signal: "meaningful" },
    { id: "retry", path: "src/retry-policy.ts", status: "added", binary: false, signal: "meaningful" },
    { id: "telemetry", path: "src/telemetry.ts", status: "modified", binary: false, signal: "meaningful" },
    { id: "runner-test", path: "test/runner.test.ts", status: "modified", binary: false, signal: "meaningful" },
    { id: "changelog", path: "CHANGELOG.md", status: "modified", binary: false, signal: "low-signal", signalReason: "Release note restates the code change." },
    { id: "lockfile", path: "package-lock.json", status: "modified", binary: false, signal: "low-signal", signalReason: "Dependency lockfile churn." },
  ],
  hunks: [
    {
      id: "runner-hunk", fileId: "runner", oldStart: 8, newStart: 8,
      lines: [
        { kind: "context", content: "export class Runner {", oldLine: 8, newLine: 8 },
        { kind: "addition", content: "  constructor(private readonly policy: RetryPolicy, private readonly telemetry: Telemetry) {}", newLine: 9 },
        { kind: "addition", content: "", newLine: 10 },
        { kind: "addition", content: "  async run(job: Job): Promise<JobResult> {", newLine: 11 },
        { kind: "addition", content: "    return this.policy.execute(() => this.execute(job), (attempt) => this.telemetry.recordRetry(job.id, attempt));", newLine: 12 },
        { kind: "addition", content: "  }", newLine: 13 },
      ],
    },
    {
      id: "runner-guard-hunk", fileId: "runner", oldStart: 21, newStart: 26,
      lines: [
        { kind: "context", content: "  private async execute(job: Job): Promise<JobResult> {", oldLine: 21, newLine: 26 },
        { kind: "deletion", content: "    return job.perform();", oldLine: 22 },
        { kind: "addition", content: "    if (job.cancelled) throw new JobCancelledError(job.id);", newLine: 27 },
        { kind: "addition", content: "    const result = await job.perform();", newLine: 28 },
        { kind: "addition", content: "    return { ...result, jobId: job.id };", newLine: 29 },
        { kind: "context", content: "  }", oldLine: 23, newLine: 30 },
      ],
    },
    {
      id: "retry-hunk", fileId: "retry", oldStart: 0, newStart: 1,
      lines: [
        { kind: "addition", content: "export class RetryPolicy {", newLine: 1 },
        { kind: "addition", content: "  constructor(private readonly maxAttempts = 3, private readonly baseDelayMs = 250) {}", newLine: 2 },
        { kind: "addition", content: "", newLine: 3 },
        { kind: "addition", content: "  async execute<T>(operation: () => Promise<T>, onRetry: (attempt: number) => void): Promise<T> {", newLine: 4 },
        { kind: "addition", content: "    for (let attempt = 1; ; attempt += 1) {", newLine: 5 },
        { kind: "addition", content: "      try { return await operation(); } catch (error) {", newLine: 6 },
        { kind: "addition", content: "        if (attempt >= this.maxAttempts || !isTransient(error)) throw error;", newLine: 7 },
        { kind: "addition", content: "        onRetry(attempt);", newLine: 8 },
        { kind: "addition", content: "        await delay(this.baseDelayMs * 2 ** (attempt - 1));", newLine: 9 },
        { kind: "addition", content: "      }", newLine: 10 },
        { kind: "addition", content: "    }", newLine: 11 },
        { kind: "addition", content: "  }", newLine: 12 },
        { kind: "addition", content: "}", newLine: 13 },
      ],
    },
    {
      id: "telemetry-hunk", fileId: "telemetry", oldStart: 14, newStart: 14,
      lines: [
        { kind: "context", content: "export class Telemetry {", oldLine: 14, newLine: 14 },
        { kind: "addition", content: "  recordRetry(jobId: string, attempt: number): void {", newLine: 15 },
        { kind: "addition", content: "    this.counter('runner.retry', { jobId, attempt }).increment();", newLine: 16 },
        { kind: "addition", content: "  }", newLine: 17 },
      ],
    },
    {
      id: "runner-test-hunk", fileId: "runner-test", oldStart: 12, newStart: 12,
      lines: [
        { kind: "addition", content: "it('runs a job', async () => {", newLine: 12 },
        { kind: "addition", content: "  await expect(runner.run(job)).resolves.toEqual(result);", newLine: 13 },
        { kind: "addition", content: "});", newLine: 14 },
      ],
    },
    {
      id: "runner-retry-test-hunk", fileId: "runner-test", oldStart: 16, newStart: 16,
      lines: [
        { kind: "addition", content: "it('retries a transient failure with backoff before succeeding', async () => {", newLine: 16 },
        { kind: "addition", content: "  job.failOnce(new TransientNetworkError());", newLine: 17 },
        { kind: "addition", content: "  await expect(runner.run(job)).resolves.toEqual(result);", newLine: 18 },
        { kind: "addition", content: "  expect(telemetry.retries('runner.retry')).toEqual([{ jobId: job.id, attempt: 1 }]);", newLine: 19 },
        { kind: "addition", content: "});", newLine: 20 },
      ],
    },
    {
      id: "changelog-hunk", fileId: "changelog", oldStart: 3, newStart: 3,
      lines: [
        { kind: "addition", content: "- The runner retries transient job failures with exponential backoff.", newLine: 3 },
      ],
    },
    {
      id: "lockfile-hunk", fileId: "lockfile", oldStart: 1201, newStart: 1201,
      lines: [
        { kind: "deletion", content: "      \"version\": \"2.4.0\",", oldLine: 1201 },
        { kind: "addition", content: "      \"version\": \"2.4.1\",", newLine: 1201 },
      ],
    },
  ],
  document: {
    summary: "The runner now executes a supplied job through a single entry point, retries transient failures with exponential backoff, and reports each retry to telemetry. The behavior is covered by focused tests for the success path and the retry path.",
    chapters: [
      {
        id: "run-job", title: "Run the supplied job", kind: "behavior",
        synopsis: "The runner delegates the job to its execution path, guards against cancelled jobs, and stamps results with the job id.",
        before: "Jobs could not be run through this entry point, and cancelled jobs were executed anyway.",
        after: "Callers run a job through one entry point and receive a result stamped with the job id; cancelled jobs fail fast.",
        confidence: "high", attention: "contained", riskCategories: ["behavior"], evidenceIds: ["runner-hunk", "runner-guard-hunk"],
      },
      {
        id: "retry-policy", title: "Retry transient failures", kind: "decision",
        synopsis: "A dedicated `RetryPolicy` retries transient errors up to three times with exponential backoff instead of failing the job on first error.",
        before: "Any transient infrastructure error failed the job immediately.",
        after: "Transient errors are retried up to three times with 250ms exponential backoff; permanent errors still fail fast.",
        confidence: "medium", attention: "elevated", riskCategories: ["behavior", "performance"], evidenceIds: ["retry-hunk"],
      },
      {
        id: "retry-telemetry", title: "Surface retry telemetry", kind: "non_functional",
        synopsis: "Every retry increments a runner.retry counter tagged with the job id and attempt number so operators can watch retry pressure.",
        before: "Retries would have been invisible to operators.",
        after: "Each retry is counted per job and attempt, making retry storms observable.",
        confidence: "high", attention: "low", riskCategories: ["performance"], evidenceIds: ["telemetry-hunk"],
      },
      {
        id: "test-job", title: "Cover job execution", kind: "test",
        synopsis: "Focused tests verify the returned result on the success path and the backoff-then-succeed retry path, including the telemetry counter.",
        confidence: "high", attention: "low", riskCategories: [], evidenceIds: ["runner-test-hunk", "runner-retry-test-hunk"],
      },
    ],
    steps: [
      {
        id: "step-01",
        title: "Run jobs through one entry point",
        goal: "Introduce the runner entry point so every job flows through a single run(job) call. The entry point owns cancellation checks and result stamping, which gives the later retry and telemetry work one seam to attach to.",
        youNowHave: "Callers can run a supplied job through `Runner.run` and receive a `JobResult` stamped with the job id. Cancelled jobs fail fast with `JobCancelledError` instead of executing.",
        deferred: [
          { concern: "Transient failures still bubble up immediately; retry semantics arrive with the policy.", resolvedByStepId: "step-02" },
          { concern: "Retries are not yet observable to operators.", resolvedByStepId: "step-03" },
          { concern: "Neither the success path nor the guard has test coverage yet.", resolvedByStepId: "step-04" },
        ],
        dependsOn: [],
        forwardRefs: { RetryPolicy: "step-02", recordRetry: "step-03" },
        advancesChapterIds: ["run-job"],
        evidenceIds: ["runner-hunk", "runner-guard-hunk"],
      },
      {
        id: "step-02",
        title: "Retry transient failures with backoff",
        goal: "Add a RetryPolicy that wraps the execution seam from the previous step. It retries only errors classified as transient, caps attempts at three, and doubles a 250ms base delay per attempt so a stuck dependency is not hammered.",
        youNowHave: "Runner.run survives transient infrastructure errors: up to three attempts with exponential backoff, while permanent errors and exhausted attempts still propagate to the caller unchanged.",
        deferred: [
          { concern: "Each retry should increment an operator-facing counter.", resolvedByStepId: "step-03" },
          { concern: "The backoff-then-succeed path needs a regression test.", resolvedByStepId: "step-04" },
          { concern: "Making maxAttempts and the base delay configurable per job class is left for a follow-up branch." },
        ],
        dependsOn: ["step-01"],
        forwardRefs: {},
        advancesChapterIds: ["retry-policy"],
        evidenceIds: ["retry-hunk"],
      },
      {
        id: "step-03",
        title: "Count retries in telemetry",
        goal: "Close the observability gap opened by the retry policy: report every retry attempt through Telemetry.recordRetry so operators can distinguish healthy occasional retries from a retry storm.",
        youNowHave: "Every retry increments the runner.retry counter tagged with job id and attempt number, satisfying the forward reference the runner entry point made to recordRetry.",
        deferred: [
          { concern: "An alerting threshold on runner.retry is intentionally left to the operations repository." },
        ],
        dependsOn: ["step-01", "step-02"],
        forwardRefs: {},
        advancesChapterIds: ["retry-telemetry"],
        evidenceIds: ["telemetry-hunk"],
      },
      {
        id: "step-04",
        title: "Cover execution and retry behavior",
        goal: "Lock in the observable behavior of the previous three steps with focused tests: the plain success path returns the stamped result, and a transient failure is retried with backoff until it succeeds while the retry counter records the attempt.",
        youNowHave: "Both the success path and the retry path have regression coverage, including the telemetry side effect, so future changes to the policy or the runner seam cannot silently change job semantics.",
        deferred: [],
        dependsOn: ["step-01", "step-02", "step-03"],
        forwardRefs: {},
        advancesChapterIds: ["test-job"],
        evidenceIds: ["runner-test-hunk", "runner-retry-test-hunk"],
      },
    ],
    omittedGroups: [
      { title: "Release bookkeeping", reason: "The changelog entry and lockfile bump restate the change without adding review signal.", evidenceIds: ["changelog-hunk", "lockfile-hunk"] },
    ],
    unclassifiedEvidenceIds: [],
    testExecution: [
      { command: "npm test", outcome: "passed", summary: "Runner suite passed; the new run and retry tests cover both execution paths.", source: "conversation" },
    ],
    focus: {
      "runner-hunk": [{ start: 11, end: 13 }],
      "runner-guard-hunk": [{ start: 27, end: 29 }],
      "retry-hunk": [{ start: 5, end: 9 }],
      "telemetry-hunk": [{ start: 15, end: 17 }],
      "runner-test-hunk": [{ start: 12, end: 14 }],
      "runner-retry-test-hunk": [{ start: 17, end: 19 }],
    },
  },
};
