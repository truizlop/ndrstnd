# ndrstnd

ndrstnd is a local comprehension workspace for large, agent-produced branch changes. It turns a branch diff into an evidence-linked Trailer, Timeline, and Full Diff instead of asking a reviewer to start in alphabetical path order.

## Install and start

    npm install -g ndrstnd
    ndrstnd auth login
    ndrstnd skill install
    ndrstnd review feature/my-change --repo /path/to/repository

The command compares the target branch to its merge-base, then writes and opens a self-contained HTML review artifact. Artifacts live under the reviewed repository’s Git-ignored `.ndrstnd/` directory, are private to the local working copy, and expire after seven days. Add `--conversation path/to/ndrstnd-conversation-v1.json` to provide optional implementation context.

ndrstnd uses Codex’s existing authenticated session. It never stores a Codex token itself.

To include staged, unstaged, and untracked changes against a specific base branch, review the checked-out worktree:

    ndrstnd review --base main --repo /path/to/repository

For a brand-new repository with no commits, compare the working tree to Git’s empty tree:

    ndrstnd review --base empty --repo /path/to/repository

## Scope

ndrstnd is for understanding code: it explains the implementation story, evidence, risk signals, and selected lines. It deliberately does not critique the change, submit review comments, or edit the branch.

## Development structure

ndrstnd keeps deterministic transformation logic in small core modules and side effects at the boundary:

- `src/server/git-model.ts` parses Git output and classifies files; `src/server/git.ts` runs Git commands.
- `src/server/analysis-core.ts` builds prompts, fallback analysis, and validation; `src/server/analyze.ts` calls Codex.
- `src/web/evidence-model.ts`, `src/web/test-plan-model.ts`, and `src/web/language.ts` derive presentation data; `src/web/page.ts` renders the self-contained artifact.

Run `npm run lint`, `npm test`, and `npm run build` before committing. The test suite includes pure unit tests, Git/HTTP/store integration tests, rendered artifact and browser-script UI tests, and an end-to-end artifact pipeline test.
