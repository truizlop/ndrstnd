# Landing-page demo videos

This directory produces `site/media/demo-codex.mp4` and `site/media/demo-claude.mp4`, the
switchable demo embedded in the landing page's "See it in action" section.

Each video is three segments:

1. **Agent app framing**: a faithful recreation of the Codex desktop app (`frames/codex.html`,
   sidebar, chat, and the embedded browser pane, which loads the real artifact in an iframe)
   or the Claude desktop app's Code tab (`frames/claude.html`). The agent finishes the checkout
   branch, the ndrstnd skill reviews it, and the artifact link is clicked.
2. **The workspace**: the real product. `review-data.ts` holds the checkout-retry-hardening
   review the whole site describes (12 files · 31 hunks · 5 chapters · 5 steps), rendered per
   agent through the real `renderArtifact()`, then driven live in Chromium (story disclosure,
   zoom dial, timeline rail, test plan, full diff) with a scripted cursor.
3. **End card**: `frames/endcard.html`.

## Regenerate

    npx tsx demo/render-artifacts.ts   # writes .ndrstnd/demo-{codex,claude}.html
    node demo/record.mjs               # records demo/out/*.webm segments (Playwright)
    demo/build-videos.sh               # edits + encodes site/media/*.mp4 and poster JPGs

The recorder serves the repository over a local HTTP port so the framing pages and artifacts
share an origin. `node demo/record.mjs codex-frame` re-records a single segment. Intermediates
in `demo/out/` and the rendered artifacts in `.ndrstnd/` are disposable; only `site/media/`
ships with the site.

House rule: no em-dashes in any copy that ends up on screen.
