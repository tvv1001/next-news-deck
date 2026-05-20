<!-- BEGIN:nextjs-agent-rules -->

# Next News Deck agent guidelines

This repo uses Next.js 16 with App Router. APIs, conventions, and file structure may differ from older Next.js versions. Read the relevant guide in `node_modules/next/dist/docs/` before changing framework-specific behavior, and heed deprecation notices.

## Product context

- Build and maintain a TweetDeck-style news dashboard for RSS, Reddit, and a focused free crawl watch lane.
- Prefer practical, legal, server-mediated integrations over browser-side scraping.
- Keep the UI compact, fullscreen, and dashboard-like.

## Architecture rules

- Fetch third-party feeds on the server, not from client components.
- Treat `lib/feeds/types.ts` as the source of truth for feed item, source, and column shapes.
- Keep Redis optional. The app must continue to work with memory cache only.
- Extend feed behavior through `lib/feeds/*`, `lib/config/default-columns.ts`, and the internal API routes before adding ad hoc client logic.
- Keep the crawler surface area small: `lib/feeds/web-crawl.ts`, `lib/crawler/scrapy-runner.ts`, and `lib/crawler/scrapy_crawler.py` are the only crawler pieces that should remain active.

## UI and interaction rules

- Preserve the fullscreen layout: page/body scrolling should stay disabled and vertical scrolling should happen inside columns.
- Keep `NewsDeck` as the orchestration layer for feed polling, column composition, and top-row controls.
- Preserve hydration-safe drag and drop. `@dnd-kit` should remain gated to client hydration to avoid SSR/client attribute mismatches.
- Keep long lists virtualized in feed columns unless there is a strong reason not to.
- Persist dashboard preferences through `hooks/useColumnState.ts` rather than scattering `localStorage` writes across components.

## Change strategy

- Make focused edits that preserve the current visual style and internal API boundaries.
- Prefer small extensions to existing hooks and dashboard components over parallel implementations.
- Remove dead code when it is clearly unused instead of leaving alternate paths behind.
- Update `README.md` when user-facing capabilities, setup, or architecture assumptions change.

## Validation

- After non-trivial code changes, run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- If you touch layout or drag/drop behavior, verify that the deck still hydrates cleanly and that only columns scroll vertically.
<!-- END:nextjs-agent-rules -->
