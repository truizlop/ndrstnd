# ndrstnd agent guide

## Product intent

ndrstnd helps a human understand a coding agent’s changes. It is a comprehension tool, not a code-critique tool: make the implementation story, decisions, risks, test coverage, and supporting evidence easy to read before making suggestions about the code.

The primary reading surface is a portable, self-contained HTML artifact. It must work just as well in Codex on desktop and on mobile. Do not make the reviewer depend on a live localhost server for ordinary reading.

## Artifact workflow

- Generate artifacts under the Git-ignored `.ndrstnd/` directory in the reviewed workspace. Never write them to a tracked path.
- After every user-visible implementation change, build the project and generate a fresh artifact with `ndrstnd review --base empty --repo <repo> --no-open` (or the appropriate base). Link that new artifact in the handoff so the user can test the actual current output.
- Keep all reader-facing interactions usable without a server: tabs, Story disclosure, zoom/detail changes, Timeline jumps, Test Plan jumps, diff expansion, review state, and export.
- When an action needs Codex context that a static artifact cannot call directly, make the action copy a concise, evidence-grounded prompt suitable for pasting into Codex. Never leave a button that only produces an empty toast.

## Review UI rules

- Treat Story as progressive disclosure. Start code evidence collapsed, show only focused evidence at intermediate levels, and make full raw evidence an explicit user action.
- Zoom must materially change the Story surface at every level. Add regression tests that assert the visual state changes, rather than only checking the selected control.
- Keep the zoom/detail control hidden outside Story when it does not affect the current view.
- Timeline and Test Plan items must lead to their corresponding Story evidence.
- Test Plan should explain grouped testing intent in plain language and list individual test cases when source evidence provides them.
- Use syntax-aware code presentation and conventional green/red diff treatment. Do not duplicate file/hunk headers in Full Diff.
- Preserve the restrained light ndrstnd visual language: white content surface, pale gray rails, dark neutral text, subtle blue accent, thin borders, and low-chrome controls. Prefer borderless gray utility buttons over heavy outlined controls.
- Design mobile layouts first-class. The document must not scroll horizontally; only code panes and deliberately overflow-safe action menus may do so.

## Naming and storage

- The product, CLI, skill, data directory, environment variables, and artifact names are `ndrstnd`. Do not reintroduce legacy product names or paths.

## Verification

- Run `npm run lint`, `npm test`, and `npm run build` for every code change.
- For artifact JavaScript, test the rendered artifact or its executed client scripts. A TypeScript build alone does not prove inline browser scripts are valid.
- Use a real browser-sized mobile viewport when changing layout or interactions. Check console errors, tabs, zoom, disclosure, Timeline/Test Plan navigation, selection-menu dismissal, and horizontal overflow.

## Git workflow

- Keep commits small and cohesive. Commit messages must be short descriptive sentences that start with a capital letter; do not use prefixes such as `feat:`, `fix:`, or `chore:`.
- Do not commit generated `.ndrstnd/` artifacts, `dist/`, or `node_modules/`.
- Do not commit unless the user explicitly requests it. When asked to commit, inspect the staged scope and report the resulting commit IDs.
