# Changelog

All notable ndrstnd changes are documented here. Versions are released as unprefixed Git tags and published through npm and the repository’s Homebrew tap.

## 0.2.0 — 2026-07-20

This release contains the changes made after 0.1.0 through the current 0.2.0 release candidate.

### Agent analysis and reliability

- Replaced the fragile compact analysis wire format in the agent prompt with an explicit named-object JSON contract. Chapters, steps, deferred items, forward references, focus ranges, and test executions now have named properties that coding agents can generate and repair more reliably.
- Kept compatibility with legacy compact responses while making the explicit format canonical, so existing cached or in-flight agent behavior can be diagnosed without weakening the new contract.
- Changed evidence references from brittle hunk ID strings to zero-based indexes in the numbered review manifest, with validation that every meaningful hunk is classified and every hunk appears in the timeline.
- Hardened JSON extraction, wire-schema validation, prose limits, evidence invariants, focus ranges, step ordering, duplicate detection, and repair prompts. Failed drafts receive targeted repair turns and transient agent failures get one fresh-client retry.
- Added clearer analysis progress and heartbeat output so long Codex or Claude Code runs are observable instead of looking hung.

### Failure diagnosis and CLI

- Added a portable `ndrstnd-analysis-diagnostic` JSON artifact for review failures. It records tool/runtime metadata, sanitized command and scope information, per-turn timings and activity, response hashes, extraction metadata, validation phases, and transport errors without including prompts, patches, environment variables, or raw responses by default.
- Added `--diagnostic-include-agent-output` for private escalations when the maintainer needs the raw agent response; such artifacts are explicitly marked sensitive.
- Made CLI failures print numbered reporting steps, including where to find the diagnostic artifact, what command and scope to attach, and what to do when the artifact itself cannot be written.
- Improved missing-agent and authentication guidance, including actionable commands for installing or signing in to Codex or Claude Code.

### Packaging, Homebrew, and documentation

- Added native `better-sqlite3` rebuild coverage to the test lifecycle and a packaged-binding smoke test in the Homebrew formula.
- Pinned the 0.1.1 and 0.1.2 Homebrew source archive hashes and documented the tap trust step and release hash workflow.
- Documented Node.js runtime and native dependency rules, merge-base review scoping, cached analysis behavior, explicit agent selection, conversation imports, and the failure-diagnostic reporting process.
- Removed a misleading Homebrew hero command from the project site.

### Verification

- Expanded analysis, CLI, parser, packaging, and diagnostic regression coverage. The release checks are `npm run lint`, `npm test`, `npm run build`, and `npm pack --dry-run`.

### Homebrew publication follow-up

The formula remains pinned to the last published 0.1.2 archive until the 0.2.0 Git tag exists on GitHub. After publishing the tag, compute the archive SHA-256 with the command documented at the top of `Formula/ndrstnd.rb`, update that formula’s URL and hash, run Homebrew audit/install checks, and commit the formula update.

## 0.1.0

- Initial public ndrstnd release as a local comprehension workspace with Story, Timeline, Test plan, and Full diff views.
