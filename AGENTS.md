# ndrstnd agent guide

## Product intent

ndrstnd helps a human understand a coding agent’s changes. It is a comprehension tool, not a code-critique tool: make the implementation story, decisions, risks, test coverage, and supporting evidence easy to read before making suggestions about the code.

The primary reading surface is a portable, self-contained HTML artifact. It must work just as well in Codex on desktop and on mobile. Do not make the reviewer depend on a live localhost server for ordinary reading.

## Artifact workflow

- Generate artifacts under the Git-ignored `.ndrstnd/` directory in the reviewed workspace. Never write them to a tracked path.
- Generate a fresh artifact with `ndrstnd review --base empty --repo <repo> --no-open` (or the appropriate base) only when the user explicitly requests a review or artifact. Link that artifact in the handoff so the user can test the current output.
- Keep all reader-facing interactions usable without a server: tabs, Story disclosure, zoom/detail changes, Timeline jumps, Test Plan jumps, diff expansion, review state, and export.
- When an action needs Codex context that a static artifact cannot call directly, make the action copy a concise, evidence-grounded prompt suitable for pasting into Codex. Never leave a button that only produces an empty toast.

## Review UI rules

- Treat Story as progressive disclosure. Start code evidence collapsed, show only focused evidence at intermediate levels, and make full raw evidence an explicit user action.
- Zoom must materially change the Story surface at every level. Add regression tests that assert the visual state changes, rather than only checking the selected control.
- Keep the zoom/detail control hidden outside Story when it does not affect the current view.
- Timeline and Test Plan items must lead to their corresponding Story evidence.
- Test Plan should explain grouped testing intent in plain language and list individual test cases when source evidence provides them.
- Use syntax-aware code presentation and conventional green/red diff treatment. Do not duplicate file/hunk headers in Full Diff.
- Preserve the restrained light ndrstnd visual language: white content surface, pale gray rails, dark neutral text, a single cobalt accent (`--accent`), hairline borders, and low-chrome controls. Prefer borderless gray utility buttons over heavy outlined controls. Never use gradients, serif faces, or emoji icons; icons are thin-stroke inline SVGs, and the brand mark is the three stacked depth chevrons with the deepest stroke in accent.
- Keep the two typographic voices with their semantic roles: mono (`--mono`) is the structural voice — letterspaced overlines, two-digit step indices, counts, identifiers (branch names, paths, code), and the depth-dial readout — while sans (`--sans`) carries prose and controls. Chapter and timeline attention is expressed by coloring the mono index and its tick or node together in the attention color, never a filled badge. Deep cobalt is reserved for interactive elements; the attention scale is green, light blue, amber, orange, red, with the light blue kept visibly lighter than the accent.
- The depth dial is the hero control: a ruler of ticks with an accent needle and a mono readout. It lives in the `.view-bar`, which must stay sticky at the top on desktop (revealing the branch ref only once the masthead scrolls away) and docked as a floating bottom pill on mobile so zoom is always reachable without covering content.
- Timeline must add information beyond Story summaries: attention-colored nodes on a spine plus the files each step touched with churn, and steps must keep jumping to their Story chapters. The mobile review-details sheet opens over a dimmed scrim with a slide-up animation and closes on outside tap.
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
