# Custom RSS Server Approaches: Analysis & Comparison

## Executive Summary

For **next-news-deck**, you have two fundamentally different strategies:

1. **Custom FastAPI/Python Server** — lightweight, code-first, programmatic
2. **Self-hosted Aggregator (FreshRSS)** — heavyweight, database-driven, UI-managed

This document analyzes both for your use case and recommends a hybrid approach.

---

## Option 1: Custom Code-First RSS Server (FastAPI)

### Architecture

```
Client (Next.js Dashboard)
    ↓
Custom RSS Endpoint (http://localhost:8000/rss.xml)
    ↓
FastAPI app with FeedGen + requests/BeautifulSoup
    ↓
Data Source (DB, scrape, existing feeds, etc.)
    ↓
RSS 2.0 XML output
```

### Advantages

✅ **Lightweight** — ~50 lines of code for a basic feed ✅ **Programmatic** — Full control over feed composition ✅ **Custom logic** — Filter, transform, dedupe items before output ✅ **Fast startup** — No database setup or migrations ✅ **No UI overhead** — Pure data pipeline, no web UI to manage ✅ **Easy to extend** — Add scrapers, aggregate feeds, transform content ✅ **Perfect for integration** — Call it from Next.js `fetchRssSource()` as just another feed source

### Disadvantages

❌ **No persistence** — Items only exist if data source provides them (no history) ❌ **No search UI** — Can't browse/manage feeds from a web interface ❌ **No user subscriptions** — Single output; can't customize per-user ❌ **Ephemeral state** — Each request regenerates feed (no caching layer built-in) ❌ **Single thread** — Blocking I/O unless you use async properly

### Fit for next-news-deck

**EXCELLENT** — This is essentially what your `/api/feeds` endpoint already does, but decoupled as a separate service.

---

## Option 2: Self-Hosted Aggregator (FreshRSS)

### Architecture

```
Client (Next.js Dashboard)
    ↓
FreshRSS API (http://localhost:8080/api/...)
    ↓
FreshRSS Database (SQLite/MySQL) + Feed Storage
    ↓
Feed Management UI, Subscriptions, Search, History
    ↓
RSS XML Export (http://localhost:8080/api/feed.rss)
```

### Advantages

✅ **Enterprise-grade** — Full feed aggregation + storage ✅ **Web UI** — Manage subscriptions, mark read, search, browse ✅ **Persistence** — Stores feed history indefinitely ✅ **Multi-user** — Each user has subscriptions and read state ✅ **Rich API** — Full REST API for programmatic access ✅ **Extensible** — Plugins, themes, extensions ecosystem ✅ **Standards-compliant** — OPML import/export, multiple output formats

### Disadvantages

❌ **Heavy overhead** — 200MB+ Docker image, full PHP stack ❌ **Database required** — SQLite minimum, MySQL recommended for scale ❌ **Operational complexity** — Backups, updates, monitoring needed ❌ **Overkill for embedded use** — You already have a Next.js dashboard ❌ **Latency** — Database round-trips for every feed request ❌ **Redundant** — Duplicates feed caching/composition you already do

### Fit for next-news-deck

**POOR** — You already have a sophisticated feed composition engine in Next.js. FreshRSS would be a parallel system competing for feeds, not complementing your dashboard.

---

## Comparison Matrix

| Criterion                    | FastAPI Custom          | FreshRSS              |
| ---------------------------- | ----------------------- | --------------------- |
| **Setup time**               | 5 min                   | 15 min (Docker)       |
| **Code lines**               | ~50–200                 | N/A (prebuilt)        |
| **Database**                 | Optional                | Required              |
| **Memory footprint**         | <50 MB                  | 200+ MB               |
| **Startup time**             | <1 sec                  | 5–10 sec              |
| **Web UI**                   | None                    | Full                  |
| **User management**          | No                      | Yes                   |
| **History/persistence**      | No                      | Yes                   |
| **Perfect for**              | Programmatic RSS output | Multi-user aggregator |
| **Integration with Next.js** | Native                  | Via API calls         |

---

## Recommendation for next-news-deck

### Primary Solution: **Custom FastAPI RSS Server** (lightweight)

**Why:**

1. You already have sophisticated feed composition in `lib/feeds/compose.ts`
2. Your dashboard is the UI — you don't need FreshRSS's web interface
3. You want real-time, performant feeds from your existing sources
4. A 50-line FastAPI endpoint can generate RSS from your already-fetched items

**Implementation pattern:**

```javascript
// In your Next.js code, you could add:
export async function generateRssFromColumn(columnId: string) {
  const { items } = await buildColumnData(columnId);
  return generateRssXml(items, {
    title: `Next News Deck - ${columnId}`,
    link: `http://localhost:3000`,
    description: `Custom RSS feed for column ${columnId}`
  });
}

// Then expose it as a route:
// app/api/feeds/column-rss/[columnId].xml
```

### Secondary Solution: **FreshRSS as a Separate System** (advanced)

**Only if you later need:**

- Multi-user support with per-user subscriptions
- Persistent feed history (archive)
- A standalone RSS reading UI
- Sharing feeds externally

In that case, FreshRSS becomes a **separate service** that:

- Manages its own feeds independently
- Could **optionally** pull from your Next.js dashboard via webhooks/API calls
- Serves as a backup/external-facing aggregator

---

## Technical Implementation Path

### Stage 1: Add RSS Export to Next.js (Recommended First Step)

```typescript
// app/api/feeds/column-rss/[columnId].ts
import { buildColumnData } from '@/lib/feeds/compose';
import { generateRssXml } from '@/lib/feeds/rss-generator';

export async function GET(req: NextRequest, { params }: { params: { columnId: string } }) {
	const columnData = await buildColumnData(params.columnId);
	const rssXml = generateRssXml(columnData.items, {
		title: `Next News Deck - ${params.columnId}`,
		link: 'http://localhost:3000',
		description: `Column: ${params.columnId}`,
	});
	return new Response(rssXml, { headers: { 'Content-Type': 'application/rss+xml' } });
}
```

**This gives you:**

- RSS output from your existing dashboard columns
- No separate service to maintain
- Full control via your existing feed logic
- Can be consumed by other readers (Feedly, Apple News, etc.)

### Stage 2: Standalone FastAPI Service (Optional)

Only if you want a **decoupled RSS generation service** for:

- Better scalability
- Separate deployment
- Standalone operation

### Stage 3: FreshRSS (Only if needed for multi-user)

Deploy as a completely separate system if you add multi-user support later.

---

## Testing Plan

1. **Test 1**: Add RSS export route to Next.js using feedgen
2. **Test 2**: Verify RSS output from a live column
3. **Test 3**: Consume RSS in a standard reader
4. **Test 4**: (Optional) Spin up standalone FastAPI as separate service
5. **Test 5**: (Optional) Deploy FreshRSS and measure overhead

---

## Conclusion

**For next-news-deck:** Build RSS export **inside your Next.js app** as a thin layer over your existing feed composition logic.

- ✅ Zero additional infrastructure
- ✅ Reuses your proven feed fetching + deduplication
- ✅ Simple: `npm install feedgen`, add one route
- ✅ Exportable: Any column becomes a shareable RSS feed
- ✅ Scalable: Caches the same way your dashboard does

Only scale to FastAPI or FreshRSS if you hit specific requirements (separate deployment, multi-user, etc.) that your Next.js app can't handle.
