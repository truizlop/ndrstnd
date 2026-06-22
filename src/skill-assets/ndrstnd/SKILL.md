---
name: ndrstnd
description: Use after completing a coding task when a human needs to understand an agent-produced branch through an evidence-led ndrstnd workspace, rather than receive a conventional critique.
---

# ndrstnd

Use ndrstnd after implementation is complete and a reviewer needs an intelligible story of the changes.

1. Identify the branch containing the finished work and the repository root.
2. If the current Codex conversation materially explains implementation decisions, create a portable `ndrstnd-conversation-v1.json` export containing only user and assistant text; do not include tool output, credentials, or reasoning records.
3. Run `ndrstnd review <branch> --repo <root>` and add `--conversation <path>` when an export exists. It writes a portable HTML artifact outside the repository; link that artifact in the Codex response so it can be read on desktop or mobile. Add `--live` only for server-backed re-analysis or questions.
4. Tell the reviewer that ndrstnd is for comprehension: Trailer for the story, Timeline for suggested reading order, and Full Diff for every hunk including collapsed low-signal files.
5. Do not treat ndrstnd findings as merge criticism or modify the branch from its workspace. Use Codex `/review` or a dedicated review workflow for critique and change requests.
