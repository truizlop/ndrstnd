# ndrstnd

ndrstnd is a local comprehension workspace for large, agent-produced branch changes. It turns a branch diff into an evidence-linked Trailer, Timeline, and Full Diff instead of asking a reviewer to start in alphabetical path order.

## Install and start

    npm install -g ndrstnd
    ndrstnd auth login
    ndrstnd skill install
    ndrstnd review feature/my-change --repo /path/to/repository

The command compares the target branch to its merge-base, then writes and opens a self-contained HTML review artifact. Artifacts live outside the repository under ndrstnd’s per-user data directory, are private to the local user, and expire after seven days, so they cannot be accidentally committed. Add `--conversation path/to/ndrstnd-conversation-v1.json` to provide optional implementation context.

Use `--live` only when you need server-backed re-analysis or evidence questions on the desktop host. Live sessions remain loopback-only:

    ndrstnd review feature/my-change --live

ndrstnd uses Codex’s existing authenticated session. It never stores a Codex token itself.

To include staged, unstaged, and untracked changes against a specific base branch, review the checked-out worktree:

    ndrstnd review --base main --repo /path/to/repository

For a brand-new repository with no commits, compare the working tree to Git’s empty tree:

    ndrstnd review --base empty --repo /path/to/repository

## Scope

ndrstnd is for understanding code: it explains the implementation story, evidence, risk signals, and selected lines. It deliberately does not critique the change, submit review comments, or edit the branch.
