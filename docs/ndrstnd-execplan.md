# Build ndrstnd: an evidence-led code comprehension workspace

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

## Purpose / Big Picture

ndrstnd helps a human understand a large branch produced by a coding agent. Instead of starting with files in path order, it turns `branch` versus its Git merge-base into a short, evidence-linked “movie trailer”: a review narrative of features, decisions, behavior changes, and areas that deserve attention. A reviewer can progressively zoom from that map into semantic before/after descriptions, ordered diff evidence, and finally the complete raw diff.

The product is deliberately a comprehension workspace, not an automated critic. It does not modify the branch, submit code-review comments, or recommend whether a change should merge. Reviewers who need critique or changes return to Codex’s native review workflow. ndrstnd answers understanding questions such as “why is this code included?”, “what calls this?”, and “what changed before and after?” while clearly labeling whether an answer is grounded in local code, supplied conversation context, or general knowledge.

After this plan is complete, a user can install the `ndrstnd` command, authenticate once through Codex, run `ndrstnd review feature/my-change`, and use a local browser workspace. The application will initially open the system browser and expose a stable localhost URL suitable for opening in Codex’s side browser. The underlying web application must not depend on undocumented Codex desktop browser APIs.

## Progress

- [x] (2026-06-19 16:20Z) Captured the product boundary, user journey, risk model, zoom levels, and conversation-context requirements with the user.
- [x] (2026-06-19 16:24Z) Inspected the local `Tutorex` app-server integration and current Codex protocol documentation.
- [x] (2026-06-19 16:30Z) Proved that a desktop rollout JSONL is discoverable by ID but cannot be treated as a stable app-server conversation import contract.
- [x] (2026-06-19 16:35Z) Created this self-contained product and technical ExecPlan before implementation.
- [x] (2026-06-19 18:52Z) Scaffolded the TypeScript CLI, token-protected loopback server, health endpoint, lint/typecheck/build scripts, and test tooling.
- [x] (2026-06-19 18:52Z) Implemented Codex-delegated authentication, JSONL app-server lifecycle, `account/read`, isolated read-only analysis turns, and one validation repair turn.
- [x] (2026-06-19 18:52Z) Implemented merge-base collection, hunk accounting, transparent low-signal classification, SQLite sessions/revisions, and portable JSON/Markdown context imports.
- [x] (2026-06-19 18:52Z) Implemented schema-validated Codex analysis with a deterministic, evidence-complete fallback.
- [x] (2026-06-19 18:52Z) Implemented Trailer, Timeline, Full Diff, semantic before/after rendering, zoom, risk hover cards, selection actions, persisted lenses/preferences/question cards, and explicit immutable re-analysis.
- [x] (2026-06-19 18:52Z) Validated the package shape, bundled Codex skill, live app-server auth/analysis, and 13 automated tests.

## Surprises & Discoveries

- Observation: The locally installed Codex app-server requires an `initialize` request followed by an `initialized` notification before normal requests. It uses newline-delimited JSON-RPC over standard input/output by default.
  Evidence: `../Tutorex/Sources/Tutorex/Auth/CodexAppServerClient.swift` implements this sequence, and the installed Codex manual describes the same lifecycle.

- Observation: The active Codex desktop conversation is stored below the configured `CODEX_HOME` as a JSONL rollout with a stable UUID and readable user/assistant message records, but a separately launched app-server rejected that rollout while reading it and returned no active threads in `thread/list`.
  Evidence: `thread/read` for the active UUID failed with `rollout ... does not start with session metadata`; `thread/list` returned zero threads. The local file was nevertheless discoverable at `~/.codex-tomas/sessions/2026/06/19/...`.

- Observation: Codex credentials are already cached and refreshed by Codex, with OS credential-store support. Duplicating them in ndrstnd would introduce unnecessary secret handling.
  Evidence: the installed Codex manual’s Authentication and sessions section describes `cli_auth_credentials_store = "keyring"` and shared cached login details.

- Observation: A live app-server analysis can return valid JSON that violates a constrained enum despite the prompt. One repair turn with the validation error corrected the response.
  Evidence: the first synthetic analysis used `kind: "code"`, which was outside ndrstnd’s allowed chapter kinds; the corrected live run returned one chapter referencing the expected evidence ID.

## Decision Log

- Decision: Build ndrstnd as a TypeScript and Node.js command-line program plus a local HTML web application.
  Rationale: Node can launch the local server, consume app-server’s JSON-RPC stream, and share types between CLI, HTTP API, persistence, and browser UI. It is the least complex route to a Codex-compatible local web experience.
  Date/Author: 2026-06-19 / User and Codex.

- Decision: Use Node’s built-in HTTP server for the local-only transport rather than introduce a web framework.
  Rationale: the local server currently needs a small, auditable loopback surface, static application delivery, JSON endpoints, and server-sent events. Node provides these without an additional runtime dependency; the project will keep route modules separate so the transport remains maintainable.
  Date/Author: 2026-06-19 / Codex.

- Decision: Compare a supplied branch to its Git merge-base, not merely to its parent commit.
  Rationale: the merge-base represents the common starting point with the branch being reviewed and keeps the review meaningful for multi-commit agent work.
  Date/Author: 2026-06-19 / User.

- Decision: The primary UI is an evidence-linked Trailer, with Timeline and Full Diff as parallel views of the same review model.
  Rationale: the reviewer should understand the implementation story before facing a large path-sorted patch; complete raw evidence remains one click away.
  Date/Author: 2026-06-19 / User and Codex.

- Decision: Risk is expressed as an attention heat level plus accessible category chips, not as a single semantic spectrum.
  Rationale: formatting, refactoring, behavioral change, performance, and security are different reasons to inspect code. The UI uses `🧹 Formatting`, `🔧 Refactor`, `🔁 Behavior`, `⚡ Performance`, and `🔐 Security` labels alongside an overall green-to-red attention bar.
  Date/Author: 2026-06-19 / User and Codex.

- Decision: ndrstnd is comprehension-only. It does not send review comments, request code changes, or modify the reviewed branch.
  Rationale: its job is to make agent work understandable. Critique belongs in Codex `/review` or other dedicated skills, avoiding a second, unfocused chat-review product.
  Date/Author: 2026-06-19 / User.

- Decision: Use Codex’s existing authentication cache. `ndrstnd auth login` invokes the Codex login flow and validates that app-server can initialize; ndrstnd stores no access token.
  Rationale: credentials stay in Codex’s managed keychain/file policy and are automatically refreshed by Codex.
  Date/Author: 2026-06-19 / User and Codex.

- Decision: Conversation context is optional and portable. V1 accepts a supplied file; support for a raw Codex thread identifier is experimental and capability-detected.
  Rationale: desktop’s private session format was not readable through a separately launched app-server in the local experiment. ndrstnd must not rely on that undocumented storage format.
  Date/Author: 2026-06-19 / User and Codex.

- Decision: Preferences that affect presentation apply immediately; analysis lenses require explicit re-analysis and produce a new analysis revision.
  Rationale: changing a Security or Performance lens can alter grouping and attention signals. Keeping revisions preserves reviewer progress and makes the effect inspectable rather than silently changing the review.
  Date/Author: 2026-06-19 / User and Codex.

- Decision: Treat phone review as a first-class mode, not a scaled desktop layout. At narrow widths, ndrstnd uses a two-row top rail, hides the desktop inspector, stacks semantic Before/After content, keeps only evidence code horizontally scrollable, and gives primary controls 44px touch targets.
  Rationale: reviewers need to understand an agent change away from a desktop without losing navigation, context, or reading comfort. The page itself must not horizontally scroll; source code is the intentional exception.
  Date/Author: 2026-06-20 / User and Codex.

## Outcomes & Retrospective

ndrstnd now implements the documented local comprehension workflow. It was verified with live Codex app-server authentication and a synthetic live analysis, plus branch/merge-base, persistence, HTTP, skill-installation, workspace-rendering, and analysis-contract tests. Codex side-panel opening remains a browser URL workflow because no supported desktop side-panel launch API was used; the normal CLI opens the default browser and prints the same localhost URL.

## Context and Orientation

The repository is empty at the start of this plan. Create a single npm workspace at the repository root. The command-line program and HTTP server live under `src/server`; the static browser application lives under `src/web`; reusable domain types live under `src/shared`; tests live under `test`.

A **review session** is persisted local state for one Git repository, target branch, merge-base commit, analysis lens, and optional conversation import. It contains the raw patch metadata, all file classifications, generated structured analysis, reviewer reading state, and question cards. A **revision** is an immutable analysis result within the same review session. A review session may have several revisions when the user reruns analysis under a different lens or after the branch changes.

A **chapter** is one Trailer card representing a coherent implementation concept such as a user-facing feature, an architectural decision, an interface contract, a non-functional effect, or a meaningful risk. Each chapter contains ordered **evidence references**. An evidence reference names a file and a patch hunk range. Chapters must cover all meaningful changed lines exactly once where possible; shared supporting code can appear in more than one chapter but must be marked as supporting evidence. Any lines that the model treats as low signal remain explicitly represented in an omitted-diff group.

An **analysis lens** is a human-readable set of priorities applied when asking Codex to organize the change. It does not change source code. Built-in lenses are Default, Security, Performance, API compatibility, Data migrations, and Test coverage. User-created lenses are local, inspectable rules such as “always elevate changes to public Swift interfaces.”

## Product Specification

### User flow

The user first runs `ndrstnd auth login`. ndrstnd invokes the configured `codex login` command only when a Codex session is unavailable, then starts a short app-server connection and checks that initialization succeeds. It reports the profile/home it will use without printing credentials. `ndrstnd auth status` reports signed-in, signed-out, or unreachable; `ndrstnd auth logout` removes only ndrstnd’s selected-profile preference unless the user explicitly supplies `--also-logout-codex`.

To begin a review, the user runs:

    ndrstnd review feature/my-change

Optional arguments are:

    --repo <path>                 Repository root; default is the current directory.
    --conversation <path>         A portable JSON or Markdown conversation export.
    --lens <built-in-or-local-id> Initial analysis lens; default is `default`.
    --port <number>               Request a localhost port; default is an available ephemeral port.
    --no-open                     Start the server without opening a browser.
    --full-reanalyze              Ignore any reusable cached revision for this exact input.
    --codex-thread <id>           Experimental; import only when app-server confirms it can read the thread.

The CLI resolves the repository root, confirms that the target is a local branch or resolvable revision, calculates `git merge-base HEAD <target>`, and rejects an absent merge-base with a useful error. It starts a loopback-only server on `127.0.0.1`, creates or restores a review session, prints the URL, and opens it through the platform browser command. A future Codex plugin may open the same URL in the side panel; this is an adapter enhancement, not a requirement for the local server.

The first screen is a staged analysis view. It announces tangible progress rather than showing an indefinite spinner: “Reading branch”, “Filtering generated files”, “Mapping dependencies”, “Drafting chapters”, and “Calibrating risk”. It presents every completed chapter immediately. Early chapters carry a “still assembling” state until Codex emits the final structured model. A partial analysis is always saved and usable if a later model request fails.

### Trailer view

The default view opens at Zoom 1, the Trailer. Its header shows the target, merge-base short hash, changed file count, meaningful line count, omitted line count, active lens, and analysis status. It then presents chapters in recommended reading order, not alphabetical file order.

Each chapter shows a concise title, a one- or two-sentence claim, attention heat, category chips, confidence, and review status. Opening a chapter exposes a semantic Before/After description when applicable, the code-derived explanation, explicitly labeled conversation-derived rationale or alternatives, and its ordered evidence list. Selecting evidence moves to the exact patch hunk without losing the chapter trail.

The Trailer includes an “omitted low-signal changes” disclosure with file and line totals. It never silently hides changes. Expanding it reveals grouped formatting, generated, vendor, lockfile, or mechanically repetitive diffs and a direct jump to Full Diff.

### Timeline and Full Diff

Timeline renders the same chapters as a dependency and implementation narrative. It uses actual commit or conversation timestamps only when supplied evidence supports them. Otherwise it is labeled “Suggested implementation story” and orders chapters by prerequisites and data/control flow.

Full Diff lists every changed file and hunk with standard additions/deletions. It defaults to a meaningful-source filter but contains an explicit “all changes” toggle that includes generated, lockfile, and vendor files. File sorting in this view may be alphabetical because it is the escape hatch, not the primary reading route.

### Zoom and risk interactions

Zoom 0 is the Map: review progress, change themes, chapter count, and risk distribution. Zoom 1 is Trailer claims. Zoom 2 adds semantic explanations, rationale, alternatives, and selected snippets. Zoom 3 is ordered patch evidence. Zoom 4 is complete raw diff. Keyboard shortcuts and a persistent control change zoom without changing the selected chapter.

Every evidence hunk has a narrow attention bar: green for low attention, blue for contained refactor attention, yellow/orange for meaningful behavioral or performance attention, and red for security or severe blast-radius attention. Color is never the only indicator. Hover or keyboard focus opens a card that lists the contributing category chips, affected surface, reason, confidence, and suggested question to ask while reading.

### Questions without chat UX

Selecting a range in a displayed diff opens a compact contextual action palette: Explain selection; Trace callers/effects; Show before/after; Why is this included?; Explain risk signal; Ask a question. “Ask a question” creates an anchored question card with a short input, rather than opening a general-purpose conversation pane. The server sends the selected text, stable evidence identifiers, nearby context, active chapter, repository context, and optional conversation import to Codex.

Answers appear in the card, preserve the selected range, and carry one provenance badge: “Based on branch and repository”, “Based on supplied conversation”, “Based on both”, or “General explanation; not repository-specific.” Question cards persist in the review session and are not delivered as comments to a source-control provider or a Codex implementation thread.

### Preferences and lenses

Presentation preferences include default zoom, compact/comfortable density, whether the timeline is shown, and dark/light/system appearance. They take effect immediately. Analysis preferences include the selected lens and user rules. After any analysis-affecting change, show a persistent banner: “Review lens changed. This affects grouping and risk signals. Re-run analysis.” The re-run button creates a new revision and keeps the prior revision available. V1 learns only from explicit user choices: selected lens, explicitly created rule, and a per-card “useful / too noisy / incorrect grouping” signal. The settings page must show every stored rule and allow it to be edited, disabled, or deleted.

## Technical Design

### Project layout and dependencies

Create `package.json` with Node 22 or newer, TypeScript in strict mode, and npm scripts for development, build, typecheck, lint, test, and end-to-end smoke checks. Use Node’s built-in HTTP server for the loopback transport, SQLite through a maintained synchronous or asynchronous Node binding for local state, Zod for untrusted JSON validation, a Git library only if it preserves raw patch hunk metadata cleanly (otherwise invoke Git using safe argument arrays), and React plus Vite for the browser UI. Use Vitest for unit/integration tests and Playwright for one browser smoke test.

The root modules are:

    src/shared/domain.ts             Branded IDs, domain types, Zod schemas, and event payloads.
    src/shared/analysis-schema.ts    The Codex output schema and parser/repair boundary.
    src/server/cli.ts                Argument parsing and command dispatch.
    src/server/http.ts               Loopback HTTP API, static files, server-sent events, and shutdown.
    src/server/git.ts                Merge-base, diff collection, file classification, and hunk indexing.
    src/server/store.ts              SQLite schema, migrations, review sessions, revisions, preferences, and cards.
    src/server/codex.ts              Spawned app-server JSONL client, login/status helpers, and streamed turns.
    src/server/conversation.ts       Portable JSON/Markdown import and experimental thread importer.
    src/server/analyze.ts            Prompt construction, progressive analysis orchestration, validation, and fallback grouping.
    src/web/main.tsx                 Browser entry point and query bootstrap.
    src/web/app.tsx                  Top-level routing, loading states, and persistent review shell.
    src/web/features/*               Trailer, timeline, raw diff, risk, zoom, selection palette, question cards, and settings.
    test/*                           Unit, integration, fixtures, and browser smoke tests.

No endpoint may bind to a non-loopback address. The server should generate an unpredictable per-launch browser token stored only in memory; browser API calls must include it via an HTTP-only same-site cookie or an initial URL fragment that is immediately exchanged for a cookie. This prevents another local page from casually reading a review session on a shared machine.

### Persistence model

Store state under the platform’s per-user application-data directory in `ndrstnd/ndrstnd.sqlite`, not inside the reviewed repository. A database migration table records schema versions. Store repository paths, branch names, commit IDs, diff metadata, model output, question cards, progress, and preferences. Do not store Codex credentials or raw unredacted app-server logs. Conversation imports are stored only when the user supplied one; provide a session-level “delete imported context” action.

The database records `review_session`, `analysis_revision`, `changed_file`, `diff_hunk`, `chapter`, `chapter_evidence`, `omitted_group`, `question_card`, `preference`, and `analysis_lens`. `review_session` uses the canonical repository path, target revision, merge-base revision, and content hash to identify reusable work. `analysis_revision` includes the lens ID, source hash, status (`queued`, `running`, `partial`, `complete`, `failed`), model metadata, and timestamps. A new branch hash or new lens creates a revision rather than mutating an existing completed result.

### Git collection and noise classification

`src/server/git.ts` obtains name/status metadata and a zero-context plus full-context patch using `git diff --find-renames --find-copies <merge-base>...<target>`. It must preserve rename information, binary-file markers, line numbers, and each hunk’s added/deleted/context lines. It separately obtains `git diff --stat` and repository ignore attributes where useful.

Classify files before model analysis. Lockfiles, generated files declared by common generated-file markers, vendored dependencies, binaries, and mechanically repetitive formatting-only files are `low-signal` by default. Classification is transparent and reversible in Full Diff. The classifier must never discard a file; it produces a reason and confidence. A user-created lens may elevate a category such as migrations or public API declarations.

For large changes, partition meaningful hunks into bounded source bundles by directory and dependency hints. Ask Codex first to create chapter candidates per bundle, then ask it to reconcile those candidates into one repository-level ordered model. Include an explicit completeness ledger: all meaningful hunks must be assigned to a chapter or an omitted group. If the ledger does not balance, show the remaining hunks in an “Unclassified evidence” group rather than inventing coverage.

### Codex integration and authentication

`src/server/codex.ts` launches `codex app-server` as a child process with input/output pipes. It sends newline-delimited JSON-RPC messages, initializes once per connection with ndrstnd client metadata and experimental capability only when a requested method requires it, then sends `initialized`. It correlates numeric request IDs, consumes streamed notifications, imposes per-request timeouts, and preserves a bounded diagnostic log that excludes credentials.

`ndrstnd auth login` first runs `codex login` in the selected `CODEX_HOME` only if `auth status` cannot establish an authenticated app-server. It must respect the user’s existing `CODEX_HOME`, including a configured custom home, and should recommend Codex keychain storage rather than configuring it silently. App-server owns token refresh. The CLI’s “logged in” claim means an app-server initialization and a harmless account/status method succeeded, not merely that an `auth.json` path exists.

Use a dedicated new ndrstnd analysis thread for each analysis revision. Do not attempt to mutate or resume the original agent’s implementation thread. The prompt says that ndrstnd is a comprehension assistant and requests valid structured data only. Stream phase messages and early chapter candidates through server-sent events. For a follow-up question card, use the revision’s analysis thread when available, passing the anchored evidence and forbidding writes; create a separate question thread only if its context budget is unsuitable.

### Conversation import contract

The documented portable format is `ndrstnd-conversation-v1.json`:

    {
      "format": "ndrstnd-conversation-v1",
      "repository": { "pathHint": "optional string", "branchHint": "optional string" },
      "messages": [
        { "role": "user|assistant", "timestamp": "ISO-8601 optional", "text": "plain text" }
      ]
    }

Markdown import accepts headings and plain transcript text as conversation-derived context with lower confidence. Importers must omit tool output, secrets, encrypted reasoning fields, and unsupported record types. The user sees a preview and message count before analysis. `--codex-thread` calls app-server `thread/read` only when supported and falls back with a clear message advising a portable export. It never scans `~/.codex*/sessions` directly in normal product use.

### Structured analysis contract

The analysis prompt includes repository facts, filtered file/hunk descriptors, relevant source excerpts, optional imported conversation, active lens rules, and hard requirements. The response must validate against `AnalysisDocument` in `src/shared/analysis-schema.ts` before persistence.

`AnalysisDocument` contains a session summary, `chapters`, `omittedGroups`, `unclassifiedEvidence`, and coverage totals. A `Chapter` requires an ID, title, kind (`feature`, `decision`, `behavior`, `non_functional`, `risk`, `test`, or `other`), synopsis, optional before/after pair, code-derived details, separately labeled conversation-derived details, alternatives with provenance, confidence (`high`, `medium`, `low`), attention (`low`, `contained`, `elevated`, `high`, `critical`), one or more risk categories, ordered evidence IDs, and recommended next chapter IDs. An `Evidence` ID can refer only to an existing persisted hunk and line range. The parser rejects unknown IDs and prevents the model from fabricating paths or line ranges.

If validation fails, send one compact repair request containing validation errors. If repair fails, persist a deterministic fallback model with a “Raw grouping; semantic analysis unavailable” banner. The fallback groups meaningful diffs by top-level directory and change type, retains all raw evidence, and lets the user retry.

### HTTP and browser interfaces

Implement JSON endpoints under `/api`:

    GET  /api/health
    GET  /api/session/:id
    GET  /api/session/:id/revisions
    POST /api/session/:id/reanalyze
    GET  /api/session/:id/events              Server-sent events for progress and revisions.
    GET  /api/revision/:id/trailer
    GET  /api/revision/:id/timeline
    GET  /api/revision/:id/diff?scope=meaningful|all
    POST /api/revision/:id/questions
    PATCH /api/preferences
    GET  /api/lenses
    POST /api/lenses
    PATCH /api/lenses/:id
    DELETE /api/lenses/:id

Every route validates the launch token and request payload. The browser stores no review database itself. The top-level route is `/review/:sessionId?revision=<id>`. The browser UI must keep selected chapter, zoom level, and scroll anchor stable when streamed content arrives.

## Plan of Work

### Milestone 1: establish a runnable local foundation

Create the strict TypeScript package, lint/test commands, root CLI command, SQLite migration setup, platform-data directory resolver, Fastify loopback server, and simple React application shell. Make `ndrstnd --help`, `ndrstnd auth status`, and `ndrstnd review <branch> --no-open` observable. The review command must serve a session URL, return HTTP `200` from `/api/health`, and exit cleanly on Ctrl-C. This is the foundation that lets every following milestone be exercised locally.

### Milestone 2: collect complete branch evidence before interpretation

Implement repository discovery, merge-base resolution, diff collection, hunk indexing, and transparent low-signal classification. Persist the exact input facts in a review session and render a basic Full Diff page, including the all-changes toggle and omitted-group disclosure. Add fixtures for rename, binary, lockfile, generated, formatting-only, and source-behavior diffs. This milestone is accepted only when every hunk is visible in Full Diff and the coverage accounting reports no silent omission.

### Milestone 3: make Codex analysis reliable and progressive

Implement the app-server transport, auth commands, portable conversation importer, structured analysis schema, initial and repair prompts, completeness ledger, and server-sent phase events. Persist partial and complete revisions. Add an injectable fake Codex transport for tests and a live-only smoke command that is skipped unless authenticated. The browser loading screen should turn streamed milestones into visible status and render early chapter cards as soon as they validate.

### Milestone 4: make the narrative a superior reading experience

Implement the Trailer, Timeline, Map, semantic Before/After blocks, evidence navigation, risk bars/tooltips, chips, four zoom levels, reading progress, and responsive Codex-like visual language. On a phone, replace the side rail with a compact top rail; keep Trailer, Timeline, and Full Diff visible; stack the header controls and semantic comparisons; and constrain horizontal scrolling to code evidence and action palettes. Use semantic HTML, keyboard access, sufficient contrast, text labels in addition to color and emoji, and 44px minimum primary touch targets. Add browser tests that prove a chapter can be opened, evidence can be reached, the Full Diff can show low-signal files, zoom does not lose selection, and a 390px viewport has no document-level horizontal overflow.

### Milestone 5: complete the comprehension loop and safe personalization

Implement range selection actions, anchored question cards, provenance labels, question persistence, presentation preferences, built-in lenses, editable custom lenses, the rerun banner, and immutable analysis revisions. A re-run must never erase the prior analysis. Add tests for each provenance state, lens-triggered re-analysis, and deleting imported conversation context. Provide clear settings explanations that no hidden behavioral profile is created.

### Milestone 6: package, document, and prove the whole journey

Add installation instructions, CLI examples, architecture notes, privacy/security notes, sample portable conversation export, and a Codex skill that tells an agent when and how to invoke `ndrstnd review` after a coding task. Package the CLI as an npm executable. Run typecheck, lint, unit/integration tests, browser tests, and a manual local end-to-end review. Document optional side-panel opening as a browser URL workflow until a supported Codex integration API is available.

## Concrete Steps

All commands below run from `/Users/tomasruizlopez/Development/ndrstnd`.

1. Bootstrap the Node workspace, then run:

       npm run typecheck
       npm test
       npm run build

   At the foundation milestone, each command exits with code `0` and the test command reports the initial test count.

2. Start a fixture review without opening a browser:

       node dist/server/cli.js review fixture/agent-change --repo test/fixtures/sample-repo --no-open

   Expected output includes a localhost URL and `merge-base=<short hash>`. Use the printed URL’s `/api/health` endpoint:

       curl -sS http://127.0.0.1:<port>/api/health

   Expected body:

       {"status":"ok"}

3. After Git collection, use the API to verify accounting:

       curl -sS http://127.0.0.1:<port>/api/revision/<id>/diff?scope=all

   The response includes all fixture files, including a lockfile or generated file, and each hunk has an ID.

4. After analysis integration, authenticate only on a trusted developer machine:

       ndrstnd auth login
       ndrstnd review feature/my-change --conversation test/fixtures/conversation.json

   The loading screen must show phase changes, then one or more Trailer chapters. The analysis response must include a coverage ledger whose meaningful hunk counts balance.

5. Run browser verification:

       npm run test:e2e

   The test starts the local server, opens a sample session, opens a Trailer chapter, reaches its evidence hunk, switches to Full Diff, changes zoom, and observes that the selected evidence remains visible.

## Validation and Acceptance

The final implementation is acceptable only when all of the following observable conditions hold:

- `ndrstnd auth login` never asks ndrstnd to receive or print an access token, and `ndrstnd auth status` validates usable Codex access through app-server.
- `ndrstnd review <branch>` compares the target to the correct merge-base, runs only a loopback server, opens or prints a usable browser URL, and creates a persistent review session.
- A completed session shows Trailer, Timeline, and Full Diff. Trailer order is semantic and evidence-linked; Timeline clearly distinguishes inferred order from timestamp-supported chronology; Full Diff exposes every file and hunk.
- The UI provides Map through Raw zoom levels, semantic Before/After where relevant, risk heat plus labeled chips, and an explanatory tooltip that works with keyboard focus.
- Low-signal changes are disclosed with counts and can be expanded. No changed hunk disappears from Full Diff or the coverage ledger.
- Selecting diff text offers the defined comprehension actions. Question cards persist, remain anchored, and label code/conversation/general provenance correctly.
- A presentation preference applies immediately. An analysis-lens change requires an explicit re-run, produces a new revision, and preserves the old revision.
- The normal conversation import path is documented portable JSON/Markdown. An unsupported Codex thread identifier fails safely without scanning private session directories.
- Unit, integration, and browser tests pass; the manual fixture flow works without live Codex credentials; live Codex behavior is tested only when a user is authenticated.

## Idempotence and Recovery

Running `ndrstnd review` repeatedly for unchanged repository inputs and the same lens reuses the latest completed revision unless `--full-reanalyze` is supplied. A failed or interrupted run persists its partial revision and can be retried from the browser or CLI without deleting prior evidence. Database migrations run transactionally. Deleting a review session deletes its imported conversation and question cards but never changes the Git repository.

If Codex is offline, unavailable, or returns invalid structured analysis, ndrstnd retains the raw diff session and supplies deterministic directory/change-type grouping. The UI identifies this state and offers a retry. If the requested port is occupied, the CLI chooses another loopback port unless the user explicitly supplied `--port`, in which case it exits with the occupied-port error and no partial server process.

## Artifacts and Notes

The current proof-of-feasibility evidence is the nearby Tutorex app-server client at `../Tutorex/Sources/Tutorex/Auth/CodexAppServerClient.swift`, which shows the required initialization handshake and a local child-process transport. ndrstnd must duplicate the protocol behavior, not the Swift implementation.

The Codex desktop conversation experiment is intentionally recorded in Surprises & Discoveries. Treat local session rollout files as private implementation detail. The portable import contract is the durable integration point for v1.

## Interfaces and Dependencies

At the end of implementation, `src/shared/domain.ts` must export at least:

    type RiskCategory = 'formatting' | 'refactor' | 'behavior' | 'performance' | 'security';
    type Attention = 'low' | 'contained' | 'elevated' | 'high' | 'critical';
    type ZoomLevel = 0 | 1 | 2 | 3 | 4;
    interface DiffHunk { id: string; fileId: string; oldStart: number; newStart: number; lines: DiffLine[]; }
    interface ReviewSession { id: string; repoPath: string; targetRef: string; mergeBase: string; }

`src/shared/analysis-schema.ts` must export Zod-backed `AnalysisDocumentSchema`, `ChapterSchema`, and `EvidenceReferenceSchema`; no model data enters persistence or rendering without parsing through them.

`src/server/git.ts` must export:

    export interface GitRepositoryReader {
      collectReviewInput(repoPath: string, targetRef: string): Promise<CollectedReviewInput>;
    }

`src/server/codex.ts` must export:

    export interface CodexClient {
      getAuthStatus(): Promise<AuthStatus>;
      startAnalysis(input: AnalysisRequest, onEvent: (event: AnalysisEvent) => void): Promise<AnalysisDocument>;
      answerQuestion(input: QuestionRequest): Promise<QuestionAnswer>;
    }

`src/server/analyze.ts` must ensure the coverage ledger balances before declaring a revision complete. `src/web/features` must render only server-provided evidence IDs and never synthesize an unlinked code claim in the browser.

## Revision History

- 2026-06-22: Renamed the product, package, CLI, skill, storage, artifact prefix, conversation format, and repository directory to `ndrstnd`. Delivery artifacts now live in the Git-ignored `.ndrstnd/` workspace directory so Codex can surface them on mobile without risking commits. The reading surface is a responsive Story, Timeline, Full diff, and conditional Test plan; Story defaults to collapsed focused evidence, Timeline opens the relevant Story evidence, and the Story-only five-step detail rail controls progressive disclosure.

- 2026-06-19: Initial plan created from the product-definition conversation. It establishes a TypeScript/Node implementation, Codex-managed authentication, portable conversation context, comprehension-only scope, explicit lens re-analysis, and the local session-format compatibility discovery.
- 2026-06-19: Selected Node’s built-in HTTP server after implementing the loopback foundation. This reduces the runtime surface without changing any product behavior.
- 2026-06-19: Added the first executable foundation: `ndrstnd review <branch> --no-open` serves a token-protected loopback page and `/api/health`; `npm run typecheck`, `npm test`, and `npm run build` pass.
- 2026-06-19: Added Git evidence collection. It resolves a checked-out branch through its upstream or a main/master fallback, preserves diff hunks and source line numbers, and transparently marks low-signal files; temporary-repository tests cover target-branch and checked-out-branch paths.
- 2026-06-19: Added Codex-managed authentication validation. `ndrstnd auth status` completes an app-server handshake and reads non-secret account state; the live local check returned `chatgpt` without exposing credentials.
- 2026-06-19: Added portable conversation import, immutable analysis revisions, and the structured evidence contract. JSON model output cannot reference unknown evidence or leave meaningful hunks unaccounted for; a deterministic fallback remains available if Codex analysis is unavailable.
- 2026-06-19: Added the local ndrstnd workspace and verified a complete live app-server analysis. The workspace is deliberately dark, editorial, and evidence-dense rather than a generic chat panel; Codex output is repaired once when schema validation catches a mismatch.
- 2026-06-19: Added durable lenses, immediate presentation preferences, question-card persistence, and authenticated local HTTP endpoints for lenses, re-analysis, and anchored questions. Re-analysis creates a new immutable revision rather than mutating the old one.
- 2026-06-19: Completed package and skill delivery. `npm pack --dry-run` contains the executable code and bundled ndrstnd skill; the skill validates, `ndrstnd skill install --force` succeeds, and lint, tests, build, and whitespace checks pass.
- 2026-06-20: Extended Git input collection to review staged, unstaged, and untracked working-tree changes against `--base <branch>`. `--base empty` compares a first uncommitted repository to Git’s empty tree; this repository was successfully analyzed through that path.
- 2026-06-20: Changed delivery to artifact-first. `ndrstnd review` now produces a standalone HTML file in the per-user ndrstnd artifact directory instead of starting a server. The artifact preserves reading interactions but cannot run fresh Codex questions or re-analysis. It is created with owner-only permissions and expired ndrstnd artifacts are removed after seven days. `--live` retains the loopback-only server for desktop-only, server-backed interactions.

## Artifact-First Delivery Migration

This section is a living ExecPlan for the mobile delivery migration. A review artifact is a single HTML file containing the analysis document, diff evidence, CSS, and browser-only interaction code. It is not written to the repository. On macOS it is stored in `~/Library/Application Support/ndrstnd/artifacts`; on Linux it is stored in `$XDG_DATA_HOME/ndrstnd/artifacts` or `~/.local/share/ndrstnd/artifacts`; on Windows it is stored in `%LOCALAPPDATA%/ndrstnd/artifacts`. A new artifact run removes ndrstnd-owned `.html` artifacts older than seven days. The cleanup never touches a non-ndrstnd filename.

### Purpose / Big Picture

Reviewers can open the same interactive Trailer, Timeline, and Full Diff from a generated file on desktop or through Codex remote file delivery. They no longer need the phone to reach a localhost port on the Mac. The artifact has no launch token, HTTP endpoint, or network request. A reviewer can expand chapters, change zoom, switch views, inspect evidence, and select code. Re-analysis and new evidence questions require returning to Codex or using the explicitly requested live desktop mode.

### Progress

- [x] (2026-06-20) Defined artifact-first delivery and chose the per-user application-data directory over a repository `.ndrstnd/` directory to prevent accidental commits by construction.
- [x] (2026-06-20) Added static artifact rendering, owner-only writes, and seven-day expiry cleanup in `src/server/artifact.ts`.
- [x] (2026-06-20) Made artifact output the default `ndrstnd review` behavior and retained `--live` for loopback server sessions.
- [x] (2026-06-20) Added artifact unit tests and ran lint, 19 tests, and production build successfully.
- [x] (2026-06-20) Verified a real generated artifact in Chromium at a 390px mobile viewport: it had no document-level horizontal overflow, made zero network requests, and its Timeline, Trailer, and chapter disclosure interactions worked.
- [ ] Manually open the artifact through the Codex mobile file-preview handoff when a connected phone is available; record any viewer-specific JavaScript limitation.

### Surprises & Discoveries

- Observation: Codex remote control exposes the host’s tools and browser setup, but its documented app-server schema has no localhost URL relay or port-forwarding request.
  Evidence: `codex app-server generate-json-schema` exposed remote-control status notifications but no browser-preview or tunnel client request.

### Decision Log

- Decision: Make self-contained HTML artifacts the default delivery surface and keep the loopback server behind `--live`.
  Rationale: artifacts can be delivered by Codex as files to desktop and mobile without exposing a local port, while live mode remains available for operations that genuinely need Codex and persisted server state.
  Date/Author: 2026-06-20 / User and Codex.

- Decision: Store artifacts outside the reviewed repository and clean them after seven days.
  Rationale: a directory outside the worktree prevents an artifact from ever entering `git status`; time-based cleanup avoids a permanent cache of review content.
  Date/Author: 2026-06-20 / User and Codex.

### Outcomes & Retrospective

The artifact-first implementation is complete in code and automated mobile verification. A real artifact was rendered at 390px wide with no network requests and working reading interactions. It has not yet been manually opened from the Codex mobile client, so that viewer-specific verification remains a final manual acceptance step rather than a blocker for the delivery architecture.

### Context and Orientation

`src/web/page.ts` renders both the existing live workspace and the artifact workspace. The artifact path calls `renderArtifact`, which omits server-backed controls and uses a client script that makes no network request. `src/server/artifact.ts` owns private per-user path selection, writing, and cleanup. `src/server/cli.ts` writes the artifact by default and opens it as a `file:` URL; it starts `src/server/http.ts` only after `--live`. `test/artifact.test.ts` proves that the generated content contains review evidence but no API or localhost reference, is owner-readable only, and that cleanup only removes expired ndrstnd-owned files.

### Plan of Work

The completed migration keeps `renderWorkspace` unchanged for live mode and adds `renderArtifact` for a static snapshot. The shared HTML structure keeps reading interactions consistent across the two modes. The artifact script deliberately replaces calls to the ndrstnd API with a concise Codex handoff toast. The CLI continues to calculate and persist the analysis before delivery, then either writes the artifact and exits or serves a live session when the reviewer explicitly supplies `--live`.

### Concrete Steps

From the repository root, run:

    npm run lint
    npm test
    npm run build
    NDRSTND_ARTIFACT_DIR=/tmp/ndrstnd-artifacts node dist/server/cli.js review --base empty --repo /Users/tomasruizlopez/Development/ndrstnd --no-open

The final command prints `ndrstnd artifact: /tmp/ndrstnd-artifacts/ndrstnd-...html`. Confirm that this path is outside the repository and that opening it does not require a running ndrstnd process. Use the printed file path as the artifact linked back into Codex.

### Validation and Acceptance

Acceptance requires all unit tests to pass, including `test/artifact.test.ts`. A generated artifact must include review evidence, have no `/api/` or `127.0.0.1` reference, and remain readable after the CLI exits. Running `git status --short` in the reviewed repository must not list the artifact. `ndrstnd review --live --no-open` must still print a `127.0.0.1` URL and stay active until interrupted.

### Idempotence and Recovery

Repeated artifact runs create separate timestamped files and safely prune only expired ndrstnd-named artifacts. If an artifact cannot be opened in a particular Codex file viewer, rerun with `--live` on the desktop host; no source, Git state, or stored review session is damaged. Removing the artifact directory is safe because review sessions remain in the separate ndrstnd SQLite data store.

### Artifacts and Notes

The artifact is intentionally not a repository file. Its generated name begins with `ndrstnd-`, has a `.html` extension, and is written with mode `0600`. The only durable user-visible reference is the absolute file path printed by the CLI.

### Interfaces and Dependencies

`src/server/artifact.ts` exports `writeReviewArtifact(session, revision, options?)`, `cleanupArtifacts(directory?, now?)`, and `defaultArtifactDirectory()`. It uses only Node’s built-in filesystem, OS, and path modules. `src/web/page.ts` exports `renderArtifact(session, revision)` in addition to `renderWorkspace`. No network transport, tunnel, token, or new external dependency is introduced.

Change note, 2026-06-20: completed the implementation and validation steps. Chromium mobile verification succeeded at 390px wide with zero non-file requests; only the connected-phone Codex viewer check remains manual because it is not controllable from this workspace.
