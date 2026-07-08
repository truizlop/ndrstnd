import type { ReviewPresentationData } from "../src/web/review-data.js";

/**
 * The landing-page demo review: the checkout retry-hardening branch the site's
 * copy, hero mock, and demo videos all describe. Rendered through the real
 * renderArtifact() by demo/render-artifacts.ts; never shipped in the package.
 */
export const demoReviewData: ReviewPresentationData = {
  sessionId: "demo-session",
  revisionId: "demo-revision",
  targetRef: "codex/checkout-retry-hardening",
  baseRef: "main",
  mergeBase: "f3a91c02b7d4e561",
  agentName: "Codex",
  files: [
    { id: "capture", path: "src/payments/capture.ts", status: "modified", binary: false, signal: "meaningful" },
    { id: "backoff", path: "src/payments/backoff.ts", status: "added", binary: false, signal: "meaningful" },
    { id: "idempotency", path: "src/payments/idempotency.ts", status: "added", binary: false, signal: "meaningful" },
    { id: "gateway", path: "src/payments/gateway.ts", status: "modified", binary: false, signal: "meaningful" },
    { id: "schema", path: "config/payment.schema.json", status: "modified", binary: false, signal: "meaningful" },
    { id: "config", path: "src/config.ts", status: "modified", binary: false, signal: "meaningful" },
    { id: "capture-test", path: "test/payments/capture.test.ts", status: "modified", binary: false, signal: "meaningful" },
    { id: "backoff-test", path: "test/payments/backoff.test.ts", status: "added", binary: false, signal: "meaningful" },
    { id: "idempotency-test", path: "test/payments/idempotency.test.ts", status: "added", binary: false, signal: "meaningful" },
    { id: "ci", path: ".github/workflows/ci.yml", status: "modified", binary: false, signal: "meaningful" },
    { id: "changelog", path: "CHANGELOG.md", status: "modified", binary: false, signal: "low-signal", signalReason: "Release note restates the code change." },
    { id: "lockfile", path: "package-lock.json", status: "modified", binary: false, signal: "low-signal", signalReason: "Dependency lockfile churn." },
  ],
  hunks: [
    {
      id: "capture-imports", fileId: "capture", oldStart: 1, newStart: 1,
      lines: [
        { kind: "context", content: "import { gateway, isTransient, PaymentIntent } from \"./gateway\";", oldLine: 1, newLine: 1 },
        { kind: "addition", content: "import { backoffDelay, sleep } from \"./backoff\";", newLine: 2 },
        { kind: "addition", content: "import { idempotencyKey } from \"./idempotency\";", newLine: 3 },
        { kind: "addition", content: "import { loadRetryPolicy } from \"../config\";", newLine: 4 },
      ],
    },
    {
      id: "capture-policy", fileId: "capture", oldStart: 14, newStart: 16,
      lines: [
        { kind: "context", content: "const log = createLogger(\"payments.capture\");", oldLine: 14, newLine: 16 },
        { kind: "addition", content: "const policy = loadRetryPolicy();", newLine: 17 },
      ],
    },
    {
      id: "capture-loop", fileId: "capture", oldStart: 18, newStart: 18,
      lines: [
        { kind: "context", content: "export async function captureCharge(intent: PaymentIntent) {", oldLine: 18, newLine: 18 },
        { kind: "deletion", content: "  return gateway.capture(intent);", oldLine: 19 },
        { kind: "addition", content: "  const key = idempotencyKey(intent);", newLine: 19 },
        { kind: "addition", content: "  for (let attempt = 0; ; attempt += 1) {", newLine: 20 },
        { kind: "addition", content: "    try {", newLine: 21 },
        { kind: "addition", content: "      return await gateway.capture(intent, { idempotencyKey: key });", newLine: 22 },
        { kind: "addition", content: "    } catch (error) {", newLine: 23 },
        { kind: "addition", content: "      if (!isTransient(error) || attempt === policy.maxAttempts) throw error;", newLine: 24 },
        { kind: "addition", content: "      await sleep(backoffDelay(policy, attempt));", newLine: 25 },
        { kind: "addition", content: "    }", newLine: 26 },
        { kind: "addition", content: "  }", newLine: 27 },
        { kind: "context", content: "}", oldLine: 20, newLine: 28 },
      ],
    },
    {
      id: "capture-receipt", fileId: "capture", oldStart: 24, newStart: 32,
      lines: [
        { kind: "addition", content: "export interface CaptureReceipt {", newLine: 32 },
        { kind: "addition", content: "  transactionId: string;", newLine: 33 },
        { kind: "addition", content: "  attempts: number;", newLine: 34 },
        { kind: "addition", content: "}", newLine: 35 },
      ],
    },
    {
      id: "backoff-types", fileId: "backoff", oldStart: 0, newStart: 1,
      lines: [
        { kind: "addition", content: "export interface RetryPolicy {", newLine: 1 },
        { kind: "addition", content: "  maxAttempts: number;", newLine: 2 },
        { kind: "addition", content: "  baseDelayMs: number;", newLine: 3 },
        { kind: "addition", content: "  maxDelayMs: number;", newLine: 4 },
        { kind: "addition", content: "  jitter: number;", newLine: 5 },
        { kind: "addition", content: "}", newLine: 6 },
      ],
    },
    {
      id: "backoff-delay", fileId: "backoff", oldStart: 0, newStart: 8,
      lines: [
        { kind: "addition", content: "export function backoffDelay(policy: RetryPolicy, attempt: number): number {", newLine: 8 },
        { kind: "addition", content: "  const exponential = policy.baseDelayMs * 2 ** attempt;", newLine: 9 },
        { kind: "addition", content: "  return Math.min(policy.maxDelayMs, jitter(exponential, policy.jitter));", newLine: 10 },
        { kind: "addition", content: "}", newLine: 11 },
      ],
    },
    {
      id: "backoff-jitter", fileId: "backoff", oldStart: 0, newStart: 13,
      lines: [
        { kind: "addition", content: "function jitter(delayMs: number, spread: number): number {", newLine: 13 },
        { kind: "addition", content: "  const window = delayMs * spread;", newLine: 14 },
        { kind: "addition", content: "  return delayMs - window / 2 + Math.random() * window;", newLine: 15 },
        { kind: "addition", content: "}", newLine: 16 },
      ],
    },
    {
      id: "backoff-sleep", fileId: "backoff", oldStart: 0, newStart: 18,
      lines: [
        { kind: "addition", content: "export function sleep(ms: number): Promise<void> {", newLine: 18 },
        { kind: "addition", content: "  return new Promise((resolve) => setTimeout(resolve, ms));", newLine: 19 },
        { kind: "addition", content: "}", newLine: 20 },
      ],
    },
    {
      id: "idempotency-key", fileId: "idempotency", oldStart: 0, newStart: 1,
      lines: [
        { kind: "addition", content: "import type { PaymentIntent } from \"./gateway\";", newLine: 1 },
        { kind: "addition", content: "", newLine: 2 },
        { kind: "addition", content: "/** Stable per intent: never derived from timestamps or attempt counters. */", newLine: 3 },
        { kind: "addition", content: "export function idempotencyKey(intent: PaymentIntent): string {", newLine: 4 },
        { kind: "addition", content: "  return `capture-${intent.id}-${intent.amount.currency}-${intent.amount.minorUnits}`;", newLine: 5 },
        { kind: "addition", content: "}", newLine: 6 },
      ],
    },
    {
      id: "idempotency-guard", fileId: "idempotency", oldStart: 0, newStart: 8,
      lines: [
        { kind: "addition", content: "export function assertKeyStable(previous: string, next: string): void {", newLine: 8 },
        { kind: "addition", content: "  if (previous !== next) throw new IdempotencyKeyDriftError(previous, next);", newLine: 9 },
        { kind: "addition", content: "}", newLine: 10 },
      ],
    },
    {
      id: "gateway-options", fileId: "gateway", oldStart: 9, newStart: 9,
      lines: [
        { kind: "addition", content: "export interface CaptureOptions {", newLine: 9 },
        { kind: "addition", content: "  idempotencyKey: string;", newLine: 10 },
        { kind: "addition", content: "}", newLine: 11 },
      ],
    },
    {
      id: "gateway-signature", fileId: "gateway", oldStart: 22, newStart: 25,
      lines: [
        { kind: "deletion", content: "  async capture(intent: PaymentIntent) {", oldLine: 22 },
        { kind: "deletion", content: "    return this.post(\"/captures\", { intent });", oldLine: 23 },
        { kind: "addition", content: "  async capture(intent: PaymentIntent, options: CaptureOptions) {", newLine: 25 },
        { kind: "addition", content: "    return this.post(\"/captures\", { intent }, { \"Idempotency-Key\": options.idempotencyKey });", newLine: 26 },
        { kind: "context", content: "  }", oldLine: 24, newLine: 27 },
      ],
    },
    {
      id: "gateway-timeout", fileId: "gateway", oldStart: 38, newStart: 41,
      lines: [
        { kind: "context", content: "    if (elapsedMs > this.timeoutMs) {", oldLine: 38, newLine: 41 },
        { kind: "deletion", content: "      throw new Error(\"gateway timeout\");", oldLine: 39 },
        { kind: "addition", content: "      throw new GatewayTimeoutError(elapsedMs);", newLine: 42 },
        { kind: "context", content: "    }", oldLine: 40, newLine: 43 },
      ],
    },
    {
      id: "gateway-transient", fileId: "gateway", oldStart: 47, newStart: 50,
      lines: [
        { kind: "addition", content: "export function isTransient(error: unknown): boolean {", newLine: 50 },
        { kind: "addition", content: "  if (error instanceof GatewayTimeoutError) return true;", newLine: 51 },
        { kind: "addition", content: "  if (error instanceof HttpError) return error.status === 429 || error.status >= 500;", newLine: 52 },
        { kind: "addition", content: "  return false;", newLine: 53 },
        { kind: "addition", content: "}", newLine: 54 },
      ],
    },
    {
      id: "schema-retry", fileId: "schema", oldStart: 31, newStart: 31,
      lines: [
        { kind: "context", content: "    \"capture\": {", oldLine: 31, newLine: 31 },
        { kind: "addition", content: "      \"retry\": {", newLine: 32 },
        { kind: "addition", content: "        \"type\": \"object\",", newLine: 33 },
        { kind: "addition", content: "        \"properties\": {", newLine: 34 },
        { kind: "addition", content: "          \"maxAttempts\": { \"type\": \"integer\", \"minimum\": 1, \"maximum\": 8 },", newLine: 35 },
        { kind: "addition", content: "          \"baseDelayMs\": { \"type\": \"integer\", \"minimum\": 50 },", newLine: 36 },
        { kind: "addition", content: "          \"maxDelayMs\": { \"type\": \"integer\", \"minimum\": 250 },", newLine: 37 },
        { kind: "addition", content: "          \"jitter\": { \"type\": \"number\", \"minimum\": 0, \"maximum\": 0.5 }", newLine: 38 },
        { kind: "addition", content: "        },", newLine: 39 },
        { kind: "addition", content: "        \"required\": [\"maxAttempts\", \"baseDelayMs\"]", newLine: 40 },
        { kind: "addition", content: "      },", newLine: 41 },
      ],
    },
    {
      id: "schema-defaults", fileId: "schema", oldStart: 58, newStart: 68,
      lines: [
        { kind: "deletion", content: "  \"default\": {}", oldLine: 58 },
        { kind: "addition", content: "  \"default\": {", newLine: 68 },
        { kind: "addition", content: "    \"retry\": { \"maxAttempts\": 3, \"baseDelayMs\": 200, \"maxDelayMs\": 2000, \"jitter\": 0.2 }", newLine: 69 },
        { kind: "addition", content: "  }", newLine: 70 },
      ],
    },
    {
      id: "config-load", fileId: "config", oldStart: 41, newStart: 41,
      lines: [
        { kind: "addition", content: "export function loadRetryPolicy(): RetryPolicy {", newLine: 41 },
        { kind: "addition", content: "  const raw = readSection(\"payment\").capture?.retry ?? {};", newLine: 42 },
        { kind: "addition", content: "  return validate(retrySchema, { ...RETRY_DEFAULTS, ...raw });", newLine: 43 },
        { kind: "addition", content: "}", newLine: 44 },
      ],
    },
    {
      id: "capture-test-setup", fileId: "capture-test", oldStart: 6, newStart: 6,
      lines: [
        { kind: "addition", content: "const flaky = (failures: number) => gatewayDouble({ failWith: new GatewayTimeoutError(3000), times: failures });", newLine: 6 },
        { kind: "addition", content: "beforeEach(() => useFakeTimers({ advanceOnSleep: true }));", newLine: 7 },
      ],
    },
    {
      id: "capture-test-retry", fileId: "capture-test", oldStart: 12, newStart: 14,
      lines: [
        { kind: "addition", content: "it(\"retries a transient timeout and captures on the second attempt\", async () => {", newLine: 14 },
        { kind: "addition", content: "  const gateway = flaky(1);", newLine: 15 },
        { kind: "addition", content: "  await expect(captureCharge(intent)).resolves.toMatchObject({ attempts: 2 });", newLine: 16 },
        { kind: "addition", content: "});", newLine: 17 },
      ],
    },
    {
      id: "capture-test-permanent", fileId: "capture-test", oldStart: 12, newStart: 19,
      lines: [
        { kind: "addition", content: "it(\"fails fast on a card decline without retrying\", async () => {", newLine: 19 },
        { kind: "addition", content: "  const gateway = gatewayDouble({ failWith: new CardDeclinedError() });", newLine: 20 },
        { kind: "addition", content: "  await expect(captureCharge(intent)).rejects.toBeInstanceOf(CardDeclinedError);", newLine: 21 },
        { kind: "addition", content: "  expect(gateway.calls).toHaveLength(1);", newLine: 22 },
        { kind: "addition", content: "});", newLine: 23 },
      ],
    },
    {
      id: "capture-test-exhaustion", fileId: "capture-test", oldStart: 12, newStart: 25,
      lines: [
        { kind: "addition", content: "it(\"surfaces the last error once maxAttempts is exhausted\", async () => {", newLine: 25 },
        { kind: "addition", content: "  const gateway = flaky(Infinity);", newLine: 26 },
        { kind: "addition", content: "  await expect(captureCharge(intent)).rejects.toBeInstanceOf(GatewayTimeoutError);", newLine: 27 },
        { kind: "addition", content: "  expect(gateway.calls).toHaveLength(4);", newLine: 28 },
        { kind: "addition", content: "});", newLine: 29 },
      ],
    },
    {
      id: "capture-test-key-reuse", fileId: "capture-test", oldStart: 12, newStart: 31,
      lines: [
        { kind: "addition", content: "it(\"sends the same idempotency key on every attempt\", async () => {", newLine: 31 },
        { kind: "addition", content: "  const gateway = flaky(2);", newLine: 32 },
        { kind: "addition", content: "  await captureCharge(intent);", newLine: 33 },
        { kind: "addition", content: "  const keys = gateway.calls.map((call) => call.headers[\"Idempotency-Key\"]);", newLine: 34 },
        { kind: "addition", content: "  expect(new Set(keys).size).toBe(1);", newLine: 35 },
        { kind: "addition", content: "});", newLine: 36 },
      ],
    },
    {
      id: "backoff-test-growth", fileId: "backoff-test", oldStart: 0, newStart: 5,
      lines: [
        { kind: "addition", content: "it(\"doubles the delay on every attempt\", () => {", newLine: 5 },
        { kind: "addition", content: "  const delays = [0, 1, 2].map((attempt) => backoffDelay(noJitter, attempt));", newLine: 6 },
        { kind: "addition", content: "  expect(delays).toEqual([200, 400, 800]);", newLine: 7 },
        { kind: "addition", content: "});", newLine: 8 },
      ],
    },
    {
      id: "backoff-test-jitter", fileId: "backoff-test", oldStart: 0, newStart: 10,
      lines: [
        { kind: "addition", content: "it(\"keeps jitter inside the configured window\", () => {", newLine: 10 },
        { kind: "addition", content: "  for (let run = 0; run < 1000; run += 1) {", newLine: 11 },
        { kind: "addition", content: "    const delay = backoffDelay(policy, 1);", newLine: 12 },
        { kind: "addition", content: "    expect(delay).toBeGreaterThanOrEqual(360);", newLine: 13 },
        { kind: "addition", content: "    expect(delay).toBeLessThanOrEqual(440);", newLine: 14 },
        { kind: "addition", content: "  }", newLine: 15 },
        { kind: "addition", content: "});", newLine: 16 },
      ],
    },
    {
      id: "backoff-test-cap", fileId: "backoff-test", oldStart: 0, newStart: 18,
      lines: [
        { kind: "addition", content: "it(\"never exceeds maxDelayMs\", () => {", newLine: 18 },
        { kind: "addition", content: "  expect(backoffDelay(noJitter, 30)).toBe(noJitter.maxDelayMs);", newLine: 19 },
        { kind: "addition", content: "});", newLine: 20 },
      ],
    },
    {
      id: "idempotency-test-stable", fileId: "idempotency-test", oldStart: 0, newStart: 4,
      lines: [
        { kind: "addition", content: "it(\"derives the same key for the same intent, every time\", () => {", newLine: 4 },
        { kind: "addition", content: "  expect(idempotencyKey(intent)).toBe(idempotencyKey(intent));", newLine: 5 },
        { kind: "addition", content: "});", newLine: 6 },
      ],
    },
    {
      id: "idempotency-test-distinct", fileId: "idempotency-test", oldStart: 0, newStart: 8,
      lines: [
        { kind: "addition", content: "it(\"derives distinct keys for distinct intents\", () => {", newLine: 8 },
        { kind: "addition", content: "  expect(idempotencyKey(intent)).not.toBe(idempotencyKey(otherIntent));", newLine: 9 },
        { kind: "addition", content: "});", newLine: 10 },
      ],
    },
    {
      id: "ci-suite", fileId: "ci", oldStart: 24, newStart: 24,
      lines: [
        { kind: "context", content: "      - run: npm test", oldLine: 24, newLine: 24 },
        { kind: "addition", content: "      - run: npm test -- payments --coverage", newLine: 25 },
      ],
    },
    {
      id: "changelog-note", fileId: "changelog", oldStart: 3, newStart: 3,
      lines: [
        { kind: "addition", content: "- Payment captures retry transient gateway failures with jittered backoff.", newLine: 3 },
      ],
    },
    {
      id: "lockfile-bump", fileId: "lockfile", oldStart: 1201, newStart: 1201,
      lines: [
        { kind: "deletion", content: "      \"version\": \"2.4.0\",", oldLine: 1201 },
        { kind: "addition", content: "      \"version\": \"2.4.1\",", newLine: 1201 },
      ],
    },
    {
      id: "lockfile-integrity", fileId: "lockfile", oldStart: 1207, newStart: 1207,
      lines: [
        { kind: "deletion", content: "      \"integrity\": \"sha512-8QWyq…\",", oldLine: 1207 },
        { kind: "addition", content: "      \"integrity\": \"sha512-1zR4d…\",", newLine: 1207 },
      ],
    },
  ],
  document: {
    summary: "Payment captures now retry transient gateway failures with jittered exponential backoff, and idempotency keys guarantee a retry can never double-charge. The retry policy is configurable through the payment schema, and focused tests pin exhaustion, jitter bounds, and key reuse.",
    chapters: [
      {
        id: "retry-captures", title: "Retry transient capture failures", kind: "behavior",
        synopsis: "captureCharge retries gateway timeouts and 5xx failures with exponential backoff and jitter instead of failing the payment on the first transient error.",
        before: "A single capture attempt per intent: any gateway timeout surfaced to the caller as a failed payment.",
        after: "Transient failures retry up to maxAttempts with jittered exponential backoff; permanent declines still fail fast.",
        confidence: "high", attention: "elevated", riskCategories: ["behavior", "performance"],
        evidenceIds: ["capture-imports", "capture-loop", "capture-receipt", "gateway-timeout", "gateway-transient"],
      },
      {
        id: "idempotency-keys", title: "Idempotency keys guard every retry", kind: "decision",
        synopsis: "A stable key per payment intent makes retries safe from double-charging: every attempt for the same intent carries the same Idempotency-Key header.",
        before: "Manual retries after a timeout risked charging the customer twice, so operators avoided retrying at all.",
        after: "Every attempt reuses the same idempotency key, so the gateway deduplicates retried captures and a retry can never double-charge.",
        confidence: "high", attention: "high", riskCategories: ["security", "behavior"],
        evidenceIds: ["idempotency-key", "idempotency-guard", "gateway-options", "gateway-signature"],
      },
      {
        id: "configurable-policy", title: "Retry policy is configurable", kind: "feature",
        synopsis: "Attempts, base delay, cap, and jitter validate through the payment config schema with safe defaults, so retry pressure is tunable without a deploy.",
        before: "Retry behavior would have been fixed in code; tuning it under an incident meant shipping a new build.",
        after: "maxAttempts, baseDelayMs, maxDelayMs, and jitter come from validated configuration with safe defaults.",
        confidence: "medium", attention: "contained", riskCategories: ["behavior"],
        evidenceIds: ["schema-retry", "schema-defaults", "config-load", "capture-policy"],
      },
      {
        id: "extract-backoff", title: "Extract a pure backoff module", kind: "other",
        synopsis: "Delay math moves to src/payments/backoff.ts as pure functions with no behavior change, so growth, jitter, and the cap are unit-testable in isolation.",
        before: "Delay math lived inline where it was awkward to test without driving the whole capture path.",
        after: "Backoff growth, jitter, and the delay cap are pure functions with direct unit coverage.",
        confidence: "high", attention: "low", riskCategories: ["refactor"],
        evidenceIds: ["backoff-types", "backoff-delay", "backoff-jitter", "backoff-sleep"],
      },
      {
        id: "test-coverage", title: "Cover exhaustion, jitter bounds, and key reuse", kind: "test",
        synopsis: "New tests pin retry exhaustion, fail-fast declines, delay bounds, and idempotency-key reuse across attempts, and CI runs the payments suite with coverage.",
        confidence: "high", attention: "low", riskCategories: [],
        evidenceIds: [
          "capture-test-setup", "capture-test-retry", "capture-test-permanent", "capture-test-exhaustion", "capture-test-key-reuse",
          "backoff-test-growth", "backoff-test-jitter", "backoff-test-cap",
          "idempotency-test-stable", "idempotency-test-distinct", "ci-suite",
        ],
      },
    ],
    steps: [
      {
        id: "step-01",
        title: "Extract a pure backoff module",
        goal: "Move delay math into src/payments/backoff.ts as pure functions (exponential growth, a bounded jitter window, and a hard cap) so the retry loop that arrives later can lean on tested arithmetic instead of inline math.",
        youNowHave: "backoffDelay, jitter, and sleep exist as pure, individually testable functions. Nothing calls them yet, so runtime behavior is unchanged.",
        deferred: [
          { concern: "The retry loop itself lands once keys and backoff are in place.", resolvedByStepId: "step-03" },
          { concern: "The policy values are still hardcoded defaults.", resolvedByStepId: "step-04" },
        ],
        dependsOn: [],
        forwardRefs: { captureCharge: "step-03" },
        advancesChapterIds: ["extract-backoff"],
        evidenceIds: ["backoff-types", "backoff-delay", "backoff-jitter", "backoff-sleep"],
      },
      {
        id: "step-02",
        title: "Guard captures with idempotency keys",
        goal: "Give every capture attempt a stable key so the retry loop, when it arrives, can never double-charge. The key derives only from the intent, never from timestamps or attempt counters, and the gateway forwards it as the Idempotency-Key header.",
        youNowHave: "Every capture attempt carries a stable idempotency key, and a drift guard fails loudly if two attempts for one intent ever disagree. Retries are now safe to introduce.",
        deferred: [
          { concern: "The retry loop itself lands once keys and backoff are in place.", resolvedByStepId: "step-03" },
          { concern: "Key stability across attempts needs a regression test.", resolvedByStepId: "step-05" },
        ],
        dependsOn: [],
        forwardRefs: {},
        advancesChapterIds: ["idempotency-keys"],
        evidenceIds: ["idempotency-key", "idempotency-guard", "gateway-options", "gateway-signature"],
      },
      {
        id: "step-03",
        title: "Retry transient captures with backoff",
        goal: "Wrap the capture call in a retry loop that only retries errors classified as transient (timeouts, 429s, and 5xxs), sleeping a jittered exponential delay between attempts and rethrowing everything else unchanged.",
        youNowHave: "captureCharge survives transient gateway failures: up to maxAttempts attempts with jittered backoff, while card declines and exhausted attempts still propagate to the caller unchanged.",
        deferred: [
          { concern: "maxAttempts and the delays are compile-time constants.", resolvedByStepId: "step-04" },
          { concern: "Neither the retry path nor exhaustion has coverage yet.", resolvedByStepId: "step-05" },
        ],
        dependsOn: ["step-01", "step-02"],
        forwardRefs: {},
        advancesChapterIds: ["retry-captures"],
        evidenceIds: ["capture-imports", "capture-loop", "capture-receipt", "gateway-timeout", "gateway-transient"],
      },
      {
        id: "step-04",
        title: "Make the retry policy configurable",
        goal: "Lift the retry constants into the payment config schema with validation and safe defaults, so operators can tune retry pressure under an incident without waiting for a deploy.",
        youNowHave: "maxAttempts, baseDelayMs, maxDelayMs, and jitter load from validated configuration; a config typo fails validation at boot instead of silently disabling retries.",
        deferred: [
          { concern: "Per-merchant policy overrides are intentionally left for a follow-up branch." },
        ],
        dependsOn: ["step-03"],
        forwardRefs: {},
        advancesChapterIds: ["configurable-policy"],
        evidenceIds: ["schema-retry", "schema-defaults", "config-load", "capture-policy"],
      },
      {
        id: "step-05",
        title: "Cover exhaustion, jitter bounds, and key reuse",
        goal: "Pin the observable behavior of the previous steps with focused tests: retry-then-succeed, fail-fast declines, exhaustion at maxAttempts, jitter staying inside its window, and one idempotency key across all attempts. Then make CI run the suite.",
        youNowHave: "The retry loop, the backoff math, and the key contract all have regression coverage, and the payments suite runs with coverage on every push.",
        deferred: [],
        dependsOn: ["step-01", "step-02", "step-03", "step-04"],
        forwardRefs: {},
        advancesChapterIds: ["test-coverage"],
        evidenceIds: [
          "capture-test-setup", "capture-test-retry", "capture-test-permanent", "capture-test-exhaustion", "capture-test-key-reuse",
          "backoff-test-growth", "backoff-test-jitter", "backoff-test-cap",
          "idempotency-test-stable", "idempotency-test-distinct", "ci-suite",
        ],
      },
    ],
    omittedGroups: [
      { title: "Release bookkeeping", reason: "The changelog entry and lockfile bump restate the change without adding review signal.", evidenceIds: ["changelog-note", "lockfile-bump", "lockfile-integrity"] },
    ],
    unclassifiedEvidenceIds: [],
    testExecution: [
      { command: "npm test -- payments", outcome: "passed", summary: "Payments suite passed: retry, fail-fast, exhaustion, jitter bounds, and key reuse are all green.", source: "conversation" },
    ],
    focus: {
      "capture-loop": [{ start: 19, end: 20 }, { start: 22, end: 22 }, { start: 24, end: 25 }],
      "capture-policy": [{ start: 17, end: 17 }],
      "capture-imports": [{ start: 2, end: 3 }],
      "capture-receipt": [{ start: 32, end: 34 }],
      "backoff-types": [{ start: 1, end: 5 }],
      "backoff-delay": [{ start: 8, end: 10 }],
      "backoff-jitter": [{ start: 13, end: 15 }],
      "backoff-sleep": [{ start: 18, end: 19 }],
      "idempotency-key": [{ start: 4, end: 5 }],
      "idempotency-guard": [{ start: 8, end: 9 }],
      "gateway-options": [{ start: 9, end: 10 }],
      "gateway-signature": [{ start: 25, end: 26 }],
      "gateway-timeout": [{ start: 42, end: 42 }],
      "gateway-transient": [{ start: 50, end: 53 }],
      "schema-retry": [{ start: 35, end: 38 }],
      "schema-defaults": [{ start: 69, end: 69 }],
      "config-load": [{ start: 41, end: 43 }],
      "capture-test-setup": [{ start: 6, end: 7 }],
      "capture-test-retry": [{ start: 14, end: 16 }],
      "capture-test-permanent": [{ start: 19, end: 22 }],
      "capture-test-exhaustion": [{ start: 25, end: 28 }],
      "capture-test-key-reuse": [{ start: 31, end: 35 }],
      "backoff-test-growth": [{ start: 5, end: 7 }],
      "backoff-test-jitter": [{ start: 10, end: 14 }],
      "backoff-test-cap": [{ start: 18, end: 19 }],
      "idempotency-test-stable": [{ start: 4, end: 5 }],
      "idempotency-test-distinct": [{ start: 8, end: 9 }],
      "ci-suite": [{ start: 25, end: 25 }],
    },
  },
};
