# Next News Deck

`next-news-deck` is a fullscreen, TweetDeck-style news dashboard built with Next.js 16, React 19, TypeScript, and Tailwind v4. It aggregates RSS and Reddit feeds on the server, normalizes and deduplicates items, caches responses in memory or Redis, and renders them in a fast multi-column client UI.

## What it does

- Aggregates RSS/Atom feeds and Reddit `.rss` feeds through a single internal API
- Renders a compact multi-column dashboard with horizontal deck scrolling
- Keeps vertical scrolling inside each column only for an app-like fullscreen layout
- Supports custom user-created columns composed from existing source snapshots
- Persists column order, visibility, custom columns, and read state in `localStorage`
- Uses virtualization to keep long columns responsive
- Uses hydration-safe drag and drop for column reordering

## Current stack

- **Framework:** Next.js 16 App Router
- **UI:** React 19 + Tailwind CSS v4
- **Feed parsing:** `rss-parser`
- **Caching:** in-memory cache with optional Redis via `ioredis`
- **DnD:** `@dnd-kit`
- **Virtualization:** `@tanstack/react-virtual`

## Getting started

1. Install dependencies with `npm install`.
2. Review `.env` and set `REDIS_URL` if you want Redis-backed caching.
3. Start the development server with `npm run dev`.
4. Open the app in your browser and verify the feed columns load.

### Environment variables

- `REDIS_URL` — enables Redis-backed caching when present
- `NEWS_DECK_USER_AGENT` — custom user agent for upstream fetches

The project works without Redis; it falls back to the built-in memory cache.

## Scripts

- `npm run dev` — start the development server
- `npm run build` — production build
- `npm run start` — run the production build locally
- `npm run lint` — run ESLint
- `npm run typecheck` — run TypeScript without emitting output

## Architecture

### Data flow

1. `app/api/feeds/route.ts` fetches and aggregates upstream feed content.
2. `lib/feeds/*` adapters normalize items into a shared feed model.
3. `lib/cache/*` applies memory or Redis caching.
4. `hooks/useFeedStream.ts` polls the internal API.
5. `components/dashboard/*` render the deck UI, column virtualization, and drag/reorder behavior.
6. `hooks/useColumnState.ts` persists local UI preferences and custom columns.

### Important modules

- `app/api/feeds/route.ts` — aggregated feed endpoint
- `app/api/health/route.ts` — cache and service health snapshot
- `lib/config/default-columns.ts` — default sources and starter columns
- `lib/feeds/types.ts` — canonical source, column, and item types
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

- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Source policy

The current implementation intentionally supports RSS/Atom and Reddit feeds only. Direct scraping of Google, Bing, FINRA, state records, or other restricted sources is out of scope for this codebase. If search integrations are added later, they should use compliant APIs rather than scraping.
