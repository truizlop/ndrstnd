---
name: ndrstnd
description: Use when a human wants to understand code changes (requests like "help me understand these changes", "explain this branch", or "walk me through this diff") and after completing a coding task when a human needs to understand the agent-produced branch through an evidence-led ndrstnd workspace, rather than receive a conventional critique.
---

# ndrstnd

Use ndrstnd whenever a human needs an intelligible story of a set of changes: after your own implementation is complete, or when asked to explain or help understand a branch, diff, or working tree that already exists, including changes produced outside this session.

1. Establish the scope before anything else: the current branch, the default branch, and `git status --porcelain`. Decide what the reviewer should see: committed work, uncommitted work, or both.
2. Pick the invocation so the diff equals exactly that work:
   - Committed work on a feature branch: `ndrstnd review <branch> --base <default-branch>`.
   - Only uncommitted changes on the checked-out branch: `ndrstnd review --uncommitted`.
   - Commits since branching plus uncommitted changes: `ndrstnd review --base $(git merge-base <default-branch> HEAD)`.
   - First delivery in a history with no useful base: `ndrstnd review --base empty`.
   Never rely on an inferred base when the local default branch may be ahead of or behind origin; ndrstnd warns when an inferred base pulls extra local commits into the review, and that warning means the base must be corrected.
3. Verify the scope cheaply before analyzing: `git diff --stat <base>...<target>` (or against the working tree) must list only files that belong to the handoff. Unrelated files mean a wrong base or stray dirty edits; fix that first, because the analysis takes minutes.
4. Export the conversation unless it contains no intent. Create a portable `ndrstnd-conversation-v1.json` with user and assistant text only, covering the motivating request, decisions, rejected alternatives, constraints, and any test or build results that were reported (commands and outcomes feed the Test plan's observed-execution evidence); never include tool output, credentials, or reasoning records. The analysis grounds its summary, before/after semantics, and step goals in this export, so omitting it produces a poorer artifact. A changed export triggers a fresh analysis rather than reusing a stale session. When the changes were produced outside this session and no dialogue about them exists, skip the export instead of fabricating one.
5. Run `ndrstnd review … --repo <root> --conversation <path> --agent <id>`, passing the agent you are (`codex` for Codex, `claude` for Claude Code) so the analysis reuses your own authenticated session instead of another installed agent's; ndrstnd detects the host agent when the flag is missing, but passing it removes the guess. Read the scope and manifest lines it prints (base, changed files, meaningful files, hunks, conversation count). If they do not match the intended handoff, correct the base and re-run. The analysis takes minutes on large branches and prints a `still analyzing` heartbeat line about every 15 seconds naming what the analysis agent is doing; while heartbeat lines keep appearing the run is healthy, so give the command a timeout of at least 15 minutes and never kill or restart it mid-analysis; that discards the whole draft.
6. Link the artifact in the handoff response so it can be read on desktop or mobile; it is self-contained, lives in the Git-ignored `.ndrstnd/` directory, and should be deleted once the review is done.
7. Tell the reviewer that ndrstnd is for comprehension: Story for the narrative, Timeline for the suggested build order, Test plan for how the behavior was exercised, and Full diff for every hunk including collapsed low-signal files.
8. Do not treat ndrstnd findings as merge criticism or modify the branch from its workspace. Use the agent's dedicated review workflow (Codex `/review` or Claude Code `/review`) for critique and change requests.
