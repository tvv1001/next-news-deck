# Next News Deck

`next-news-deck` is a fullscreen, TweetDeck-style news dashboard built with Next.js 16, React 19, TypeScript, and Tailwind v4. It aggregates RSS, Reddit, and a focused free crawl watch lane on the server, normalizes and deduplicates items, caches responses in memory or Redis, and renders them in a fast multi-column client UI.

## What it does

- Aggregates RSS/Atom feeds and Reddit `.rss` feeds through a single internal API
- Enriches RSS items with full article text and filters thin headline-only entries
- Performs multi-depth crawler-backed crawling with per-domain rate limiting
- Seeds the crawl watch lane from Bing/Google discovery pages, mines inline structured data, and scans relevant linked PDFs into cards
- Extracts article metadata (author, publish date, category, linked documents)
- Renders a compact multi-column dashboard with horizontal deck scrolling
- Keeps vertical scrolling inside each column only for an app-like fullscreen layout
- Supports custom user-created columns composed from existing source snapshots
- Persists column order, visibility, custom columns, and read state in `localStorage`
- Uses virtualization to keep long columns responsive
- Uses hydration-safe drag and drop for column reordering
- Supports a crawler-backed watch lane using a small Scrapy bridge plus a built-in HTML fallback
- Pushes live "new card ready" notifications over Server-Sent Events (SSE), with a slow fallback refresh instead of constant polling

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
4. Open the app in your browser and verify the feed columns load and the header shows `live updates on`.

## Environment variables

- `REDIS_URL` — enables Redis-backed caching when present
- `NEWS_DECK_USER_AGENT` — custom user agent for upstream fetches
- `PYTHON_BIN` — Python executable used for the optional Scrapy bridge
- `SCRAPY_TIMEOUT_MS` — timeout for Scrapy-backed crawl attempts before fallback
- `NEWS_DECK_RSS_ARTICLE_TIMEOUT_MS` — per-article fetch timeout (milliseconds)
- `NEWS_DECK_RSS_MIN_CONTENT_CHARS` — minimum article text length to keep RSS items
- `NEWS_DECK_RSS_ARTICLE_CONCURRENCY` — max concurrent article fetches per RSS source
- `NEWS_DECK_CRAWL_DEPTH` — crawler depth for web-crawl feed sources (default: 2)
- `NEWS_DECK_CRAWL_MAX_PAGES` — max pages to crawl per source (default: 18)
- `NEWS_DECK_DOMAIN_RATE_LIMIT_MS` — milliseconds between requests to same domain (default: 300)
- `NEWS_DECK_DOMAIN_MAX_CONCURRENT` — max concurrent domains to crawl (default: 2)

The project works without Redis; it falls back to the built-in memory cache.

If Scrapy is not installed in the selected Python environment, the crawler lane automatically falls back to the built-in `cheerio` crawler instead of breaking the rest of the app.

## Scripts

- `pnpm dev` — start the development server
- `pnpm build` — production build
- `pnpm start` — run the production build locally
- `pnpm lint` — run ESLint
- `pnpm typecheck` — run TypeScript without emitting output
- `pnpm test:rss` — test RSS export functionality (coming soon)

## RSS Export

All dashboard columns can be exported as standard RSS 2.0 feeds, enabling consumption by any RSS reader (Feedly, Apple News, Inoreader, NetNewsWire, etc.).

### Export column as RSS

```bash
# Get a column as RSS XML
curl http://localhost:3000/api/feeds/export/column.xml?columnId=technology
```

Paste the URL into any RSS reader to subscribe to live updates from that dashboard column.

### Export all sources as OPML

```bash
# Get all feed sources in OPML format (for sharing/importing)
curl http://localhost:3000/api/feeds/export/opml.ts
```

OPML is a standard format for sharing RSS subscriptions. Use this to import all feeds into another reader or to back up your subscription list.

### Features

- **Real-time**: RSS feeds reflect the same deduplication and enrichment as your dashboard
- **Filtered**: Export respects column filtering (tags, source selection)
- **Cached**: 5-minute cache on column RSS to reduce server load
- **Standard**: Valid RSS 2.0 with proper XML escaping and metadata

## Architecture

### Data flow

1. `app/api/feeds/route.ts` fetches and aggregates upstream feed content.
2. `lib/feeds/*` adapters normalize items into a shared feed model.
3. `lib/cache/*` applies memory or Redis caching.
4. `hooks/useFeedStream.ts` performs the initial fetch, listens to `/api/feeds/stream`, and only re-fetches when the server emits a real update (plus a slow safety fallback).
5. `components/dashboard/*` render the deck UI, column virtualization, and drag/reorder behavior.
6. `hooks/useColumnState.ts` persists local UI preferences and custom columns.

`Crawl Watch` uses the `web-crawl` adapter with the small TypeScript Scrapy bridge in `lib/crawler/scrapy-runner.ts`. When Scrapy is unavailable, the adapter falls back to the built-in `cheerio` crawler. The default free watch query is `$TSLA`; the crawler is now seeded from Bing and Google search/news pages, mines inline JSON-LD or other structured data from the returned HTML, avoids quote/product landing pages, and follows relevant article-linked PDFs so filings and source documents can appear as cards.

### Important modules

- `app/api/feeds/route.ts` — aggregated feed endpoint
- `app/api/feeds/stream/route.ts` — SSE endpoint for push-based “new card ready” events
- `app/api/health/route.ts` — cache and service health snapshot
- `lib/config/default-columns.ts` — default sources and starter columns
- `lib/feeds/types.ts` — canonical source, column, and item types
- `lib/feeds/live-updates.ts` — in-process live update pub/sub and feed-change event generation
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
