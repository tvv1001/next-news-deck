# Next News Deck

`next-news-deck` is a fullscreen, TweetDeck-style news dashboard built with Next.js 16, React 19, TypeScript, and Tailwind v4. It aggregates RSS, Reddit, and a focused free crawl watch lane on the server, normalizes and deduplicates items, caches responses in memory or Redis, and renders them in a fast multi-column client UI.

## What it does

- Aggregates RSS/Atom feeds and Reddit `.rss` feeds through a single internal API
- Enriches RSS items with full article text and filters thin headline-only entries
- Renders a compact multi-column dashboard with horizontal deck scrolling
- Keeps vertical scrolling inside each column only for an app-like fullscreen layout
- Supports custom user-created columns composed from existing source snapshots
- Persists column order, visibility, custom columns, and read state in `localStorage`
- Uses virtualization to keep long columns responsive
- Uses hydration-safe drag and drop for column reordering
- Supports a crawler-backed watch lane using a small Scrapy bridge plus a built-in HTML fallback

## Current stack

- **Framework:** Next.js 16 App Router
- **UI:** React 19 + Tailwind CSS v4
- **Feed parsing:** `rss-parser`
- **HTML crawling/parsing:** `cheerio`
- **Optional deeper crawl bridge:** Python Scrapy runner via `lib/crawler/scrapy_crawler.py`
- **Caching:** in-memory cache with optional Redis via `ioredis`
- **DnD:** `@dnd-kit`
- **Virtualization:** `@tanstack/react-virtual`

## Getting started

1. Install dependencies with `pnpm install`.
2. Review `.env` and set `REDIS_URL` if you want Redis-backed caching.
3. Start the development server with `pnpm dev`.
4. Open the app in your browser and verify the feed columns load.

### Environment variables

- `REDIS_URL` — enables Redis-backed caching when present
- `NEWS_DECK_USER_AGENT` — custom user agent for upstream fetches
- `PYTHON_BIN` — Python executable used for the optional Scrapy bridge
- `SCRAPY_TIMEOUT_MS` — timeout for Scrapy-backed crawl attempts before fallback
- `NEWS_DECK_RSS_ARTICLE_TIMEOUT_MS` — per-article fetch timeout (milliseconds)
- `NEWS_DECK_RSS_MIN_CONTENT_CHARS` — minimum article text length to keep RSS items
- `NEWS_DECK_RSS_ARTICLE_CONCURRENCY` — max concurrent article fetches per RSS source

The project works without Redis; it falls back to the built-in memory cache.

If Scrapy is not installed in the selected Python environment, the crawler lane automatically falls back to the built-in `cheerio` crawler instead of breaking the rest of the app.

## Scripts

- `pnpm dev` — start the development server
- `pnpm build` — production build
- `pnpm start` — run the production build locally
- `pnpm lint` — run ESLint
- `pnpm typecheck` — run TypeScript without emitting output

## Architecture

### Data flow

1. `app/api/feeds/route.ts` fetches and aggregates upstream feed content.
2. `lib/feeds/*` adapters normalize items into a shared feed model.
3. `lib/cache/*` applies memory or Redis caching.
4. `hooks/useFeedStream.ts` polls the internal API.
5. `components/dashboard/*` render the deck UI, column virtualization, and drag/reorder behavior.
6. `hooks/useColumnState.ts` persists local UI preferences and custom columns.

`Crawl Watch` uses the `web-crawl` adapter with the small TypeScript Scrapy bridge in `lib/crawler/scrapy-runner.ts`. When Scrapy is unavailable, the adapter falls back to the built-in `cheerio` crawler. The default free watch query is `$TSLA`, and the crawler applies per-domain balancing so one source does not dominate the pinned right-most lane.

### Important modules

- `app/api/feeds/route.ts` — aggregated feed endpoint
- `app/api/health/route.ts` — cache and service health snapshot
- `lib/config/default-columns.ts` — default sources and starter columns
- `lib/feeds/types.ts` — canonical source, column, and item types
- `lib/crawler/scrapy-runner.ts` — TypeScript bridge for the minimal generic Scrapy crawler
- `lib/feeds/web-crawl.ts` — focused HTML crawler for watch-lane sources
- `components/dashboard/NewsDeck.tsx` — main fullscreen dashboard shell
- `components/dashboard/ColumnComposer.tsx` — compact top-row column controls and custom column builder

## UI behavior to preserve

- The app is designed to feel like a dashboard, not a long page.
- The page body should not scroll.
- Column content should scroll internally.
- `@dnd-kit` rendering is hydration-gated to avoid SSR/client mismatches.

If you change layout or drag/drop behavior, verify those rules still hold.

## AI contributor setup

This repository uses `AGENTS.md` as the single always-on instruction file for Copilot-style agents. That is intentional: the customization reference recommends using **either** `AGENTS.md` **or** `.github/copilot-instructions.md`, not both.

Project-specific AI assets:

- `AGENTS.md` — shared workspace-wide coding instructions
- `.github/agents/next-news-deck-builder.agent.md` — focused agent for this dashboard

## Suggested validation after code changes

Run all three when making non-trivial changes:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`

## Source policy

The app supports RSS/Atom, Reddit RSS, and limited focused crawling of public web pages. It does **not** scrape Google or Bing results pages directly, and it stays within compliant, server-mediated integrations.
