# Deep Web Crawler Architecture: Quick Results + Background Crawling

## Overview

Build a crawler that:

1. **Returns fast** — Returns top N results immediately (within 2-3 seconds)
2. **Crawls deeply in background** — Continues searching and indexing while returning results
3. **Updates progressively** — New items flow into the feed as they're discovered
4. **Rates intelligently** — Respects domain limits while exploring breadth and depth

---

## Architecture

### Request Flow

```
User/Dashboard
    ↓
GET /api/feeds?columnId=watch-tsla-web
    ↓
┌─────────────────────────────────────────────────────┐
│ Fast Path (0-2 sec)                                 │
│ ├─ Get cached items from Redis/memory              │
│ ├─ Start shallow crawl (depth=1, top 6 links)      │
│ ├─ Score & rank results                            │
│ └─ Return top 10 items immediately                 │
└─────────────────────────────────────────────────────┘
    ↓
    Return to user (dashboard updates)
    ↓
┌─────────────────────────────────────────────────────┐
│ Background Path (60-180 sec, parallel)              │
│ ├─ Deep crawl (depth=3, all discovered links)      │
│ ├─ Extract content & metadata                      │
│ ├─ Score all items                                 │
│ ├─ Store new items in cache                        │
│ └─ Publish updates via webhook/SSE (optional)      │
└─────────────────────────────────────────────────────┘
    ↓
    Cache updated; next request gets more results
```

---

## Implementation Strategy

### 1. Two-Tier Crawling

**Tier 1: Fast (Immediate)**

```javascript
// Quick surface crawl
const fastCrawl = async (source, maxSeconds = 2) => {
	const startTime = Date.now();
	const results = [];

	// Crawl with strict time & depth limits
	for (const seed of source.seedUrls) {
		if (Date.now() - startTime > maxSeconds * 1000) break;

		const page = await fetchPage(seed);
		results.push(...scoreAndExtract(page));

		// Only follow N top links
		for (const link of page.links.slice(0, 3)) {
			if (Date.now() - startTime > maxSeconds * 1000) break;
			const subpage = await fetchPage(link);
			results.push(...scoreAndExtract(subpage));
		}
	}

	return results.sort((a, b) => b.score - a.score).slice(0, 10); // Return top 10
};
```

**Tier 2: Deep (Background)**

```javascript
// Deep crawl with no time constraints
const deepCrawl = async (source, maxDepth = 3) => {
	const queue = source.seedUrls.map((url) => ({ url, depth: 0 }));
	const visited = new Set();
	const results = [];

	while (queue.length > 0) {
		const { url, depth } = queue.shift();

		if (visited.has(url) || depth >= maxDepth) continue;
		visited.add(url);

		const page = await fetchPage(url);
		results.push(...scoreAndExtract(page));

		// Add all links to queue for next depth level
		for (const link of page.links) {
			if (!visited.has(link)) {
				queue.push({ url: link, depth: depth + 1 });
			}
		}

		// Rate limiting per domain
		await rateLimiter.waitForSlot(url);
	}

	return results;
};
```

### 2. Immediate Response Strategy

```typescript
export async function fetchWebCrawlSource(source: FeedSourceConfig) {
	const fetchedAt = new Date().toISOString();

	// Tier 1: Fast crawl - return immediately
	const fastResults = await crawlFast(source);
	const items = toFeedItems(fastResults, source);

	// Start Tier 2 in background (don't await)
	crawlDeepInBackground(source).catch((err) => console.error('Background crawl error:', err));

	// Return immediately with fast results
	return {
		source,
		items,
		fetchedAt,
		staleAt: new Date(Date.now() + source.pollMinutes * 60_000).toISOString(),
	};
}

// Run in background, update cache
async function crawlDeepInBackground(source: FeedSourceConfig) {
	const deepResults = await crawlDeep(source);
	const items = toFeedItems(deepResults, source);

	// Merge with existing cache
	const cacheKey = `feed-source:${source.id}`;
	const existing = await getFromCache(cacheKey);
	const merged = dedupeAndMerge(existing.items, items);

	// Update cache with new items
	await updateCache(cacheKey, {
		...existing,
		items: merged,
		updatedAt: new Date().toISOString(),
	});
}
```

### 3. Progressive Updates

**Option A: Polling (Simplest)**

```javascript
// Client polls same endpoint again in 30 seconds
// Gets previous fast results + any new deep crawl results
const pollInterval = setInterval(() => {
	fetch('/api/feeds?columnId=watch-tsla-web')
		.then((r) => r.json())
		.then((data) => {
			// Merge with existing items, avoiding duplicates
			updateFeedColumn(data.items);
		});
}, 30000); // Poll every 30 seconds
```

**Option B: Server-Sent Events (Real-time)**

```typescript
// Server pushes updates as they're discovered
export async function crawlWithUpdates(source: FeedSourceConfig, onItem: (item: FeedItem) => void) {
	for await (const page of crawlDeepStream(source)) {
		const item = toFeedItem(page, source);
		onItem(item); // Push to client
	}
}

// Client subscribes to SSE
const eventSource = new EventSource('/api/feeds/subscribe?columnId=watch-tsla-web');
eventSource.onmessage = (event) => {
	const item = JSON.parse(event.data);
	addItemToColumn(item);
};
```

**Option C: Webhook (External systems)**

```javascript
// POST to external webhook as new items discovered
for await (const item of crawlDeepStream(source)) {
	await fetch(source.webhookUrl, {
		method: 'POST',
		body: JSON.stringify({ sourceId: source.id, item }),
	});
}
```

---

## Code Implementation

### Step 1: Split crawl into two functions

```typescript
// Fast crawl - return within 2 seconds
async function crawlFast(source: FeedSourceConfig, tokens: string[]): Promise<ExtractedPage[]> {
	const startTime = Date.now();
	const maxDurationMs = 2000; // 2 second hard limit
	const results: ExtractedPage[] = [];

	for (const seedUrl of source.seedUrls) {
		if (Date.now() - startTime > maxDurationMs) break;

		try {
			const page = await fetchAndExtractPage(seedUrl, source);
			if (page) results.push(page);

			// Follow only top 3 links
			for (const link of page.links.slice(0, 3)) {
				if (Date.now() - startTime > maxDurationMs) break;
				const subpage = await fetchAndExtractPage(link, source);
				if (subpage) results.push(subpage);
			}
		} catch (err) {
			console.error(`Fast crawl error for ${seedUrl}:`, err);
		}
	}

	return results.sort((a, b) => b.score - a.score).slice(0, 10); // Top 10 only
}

// Deep crawl - no time limit, full exploration
async function crawlDeep(source: FeedSourceConfig, tokens: string[]): Promise<ExtractedPage[]> {
	const queue: CrawlQueueItem[] = (source.seedUrls ?? []).map((url) => ({
		url,
		depth: 0,
	}));

	const visited = new Set<string>();
	const results: ExtractedPage[] = [];
	const maxDepth = source.crawlDepth ?? 3;
	const maxPages = source.crawlMaxPages ?? 50;

	while (queue.length > 0 && results.length < maxPages) {
		const { url, depth } = queue.shift()!;

		if (visited.has(url) || depth >= maxDepth) continue;
		visited.add(url);

		try {
			// Rate limit per domain
			await RATE_LIMITER.waitForSlot(url);

			const page = await fetchAndExtractPage(url, source);
			if (page) {
				results.push(page);

				// Add all links to queue for deeper exploration
				for (const link of page.links) {
					if (!visited.has(link) && depth + 1 < maxDepth) {
						queue.push({ url: link, depth: depth + 1 });
					}
				}
			}
		} catch (err) {
			console.error(`Deep crawl error for ${url}:`, err);
		} finally {
			RATE_LIMITER.release(url);
		}
	}

	return results;
}

// Main function - fast immediate + background deep
export async function fetchWebCrawlSource(source: FeedSourceConfig): Promise<FeedSourceResult> {
	const tokens = tokenizeQuery(source.query);

	// Tier 1: Fast crawl (blocks until complete)
	const fastMatches = await crawlFast(source, tokens);
	const rankedMatches = fastMatches.sort((a, b) => b.score - a.score);
	const balancedMatches = limitPagesPerDomain(rankedMatches, 3);

	const fetchedAt = new Date().toISOString();
	const items = dedupeAndSortFeedItems(balancedMatches.map((page) => toFeedItem(page, source))).slice(0, source.maxItems);

	// Return immediately with fast results
	const result: FeedSourceResult = {
		source,
		items,
		fetchedAt,
		staleAt: new Date(Date.now() + source.pollMinutes * 60_000).toISOString(),
	};

	// Tier 2: Deep crawl in background (fire and forget)
	crawlDeepAndUpdateCache(source, tokens).catch((err) => {
		console.error(`Background crawl failed for ${source.id}:`, err);
	});

	return result;
}

// Background task - update cache with deep crawl results
async function crawlDeepAndUpdateCache(source: FeedSourceConfig, tokens: string[]) {
	try {
		const deepMatches = await crawlDeep(source, tokens);
		const rankedMatches = deepMatches.sort((a, b) => b.score - a.score);
		const balancedMatches = limitPagesPerDomain(rankedMatches, 5);

		const newItems = dedupeAndSortFeedItems(balancedMatches.map((page) => toFeedItem(page, source))).slice(0, source.maxItems * 2); // Allow more items

		// Update cache
		const cacheKey = `feed-source:${source.id}`;
		await updateCacheWithMerge(cacheKey, {
			source,
			items: newItems,
			fetchedAt: new Date().toISOString(),
			staleAt: new Date(Date.now() + source.pollMinutes * 60_000).toISOString(),
		});

		console.log(`Deep crawl completed for ${source.id}: ${newItems.length} items`);
	} catch (err) {
		console.error(`Deep crawl failed for ${source.id}:`, err);
	}
}
```

### Step 2: Add background task handling

```typescript
// lib/crawler/background-crawler.ts

import { FeedSourceConfig } from '@/lib/feeds/types';

// Track active background tasks
const activeTasks = new Map<string, Promise<void>>();

export async function queueBackgroundCrawl(source: FeedSourceConfig) {
	const taskId = `crawl:${source.id}`;

	// Don't queue if already running
	if (activeTasks.has(taskId)) {
		console.log(`Crawl already queued for ${source.id}`);
		return;
	}

	// Start background task
	const task = crawlDeepAndUpdateCache(source, tokenizeQuery(source.query)).finally(() => activeTasks.delete(taskId));

	activeTasks.set(taskId, task);
	return task;
}

export function getActiveTaskCount(): number {
	return activeTasks.size;
}
```

### Step 3: Configure crawl parameters

```typescript
// lib/config/default-columns.ts

{
  id: 'watch-tsla-web',
  kind: 'web-crawl',
  title: 'Watch TSLA',
  description: 'Deep web crawl for Tesla/TSLA news',
  siteUrl: 'https://example.com',
  feedUrl: 'https://example.com',
  pollMinutes: 30,
  maxItems: 15,
  seedUrls: [
    'https://news.google.com/search?q=TSLA',
    'https://www.google.com/news?q=Tesla',
  ],
  crawlDepth: 3,        // How many levels deep to crawl
  crawlMaxPages: 50,    // Max total pages to crawl
  crawlEngine: 'cheerio', // or 'scrapy' if available
  sameDomainOnly: false, // Allow following to different domains
  tags: ['stocks', 'tesla'],
  query: 'TSLA Tesla',
}
```

---

## Performance Tuning

### Cache Strategy

```typescript
// Return immediately from cache while crawling in background
async function getCrawlWithBackground(source: FeedSourceConfig) {
	// Always return from cache first
	const cached = await getCachedValue(
		`feed-source:${source.id}`,
		source.pollMinutes * 60_000,
		() => crawlFast(source), // Fallback if no cache
	);

	// Queue deep crawl asynchronously
	queueBackgroundCrawl(source).catch(console.error);

	return cached;
}
```

### Rate Limiting

```typescript
// Respect server limits while exploring
const RATE_LIMITER = new DomainRateLimiter(
	300, // 300ms between requests per domain
	2, // Max 2 concurrent domains
);

// Per-domain request budgets
const DOMAIN_BUDGETS = new Map<string, number>();
const MAX_REQUESTS_PER_DOMAIN = 8;

function canRequestDomain(url: string): boolean {
	const domain = new URL(url).hostname;
	const used = DOMAIN_BUDGETS.get(domain) ?? 0;
	return used < MAX_REQUESTS_PER_DOMAIN;
}

function markDomainRequest(url: string) {
	const domain = new URL(url).hostname;
	DOMAIN_BUDGETS.set(domain, (DOMAIN_BUDGETS.get(domain) ?? 0) + 1);
}

// Reset budgets every poll cycle
function resetBudgets() {
	DOMAIN_BUDGETS.clear();
}
```

---

## Monitoring & Visibility

### Track crawl progress

```typescript
interface CrawlMetrics {
	sourceId: string;
	pagesVisited: number;
	itemsFound: number;
	errorCount: number;
	durationMs: number;
	durationCrawlMs: number; // Just crawl time
	itemsPerSecond: number;
	averageScorePerItem: number;
}

const crawlMetrics = new Map<string, CrawlMetrics>();

// Log to monitoring system
function recordCrawlMetrics(source: FeedSourceConfig, metrics: CrawlMetrics) {
	crawlMetrics.set(source.id, metrics);
	console.log(`Crawl metrics for ${source.id}:`, metrics);

	// Send to monitoring (New Relic, DataDog, etc)
	if (process.env.MONITORING_ENABLED) {
		sendMetrics(metrics);
	}
}
```

### Health endpoint

```typescript
// GET /api/health
export async function GET() {
	const activeTaskCount = getActiveTaskCount();
	const recentMetrics = Array.from(crawlMetrics.values()).slice(-10);

	return NextResponse.json({
		status: 'ok',
		crawling: {
			activeTasks: activeTaskCount,
			recentMetrics,
		},
	});
}
```

---

## Example Configuration

```typescript
// Seed URL = entry point
// Deep crawl = follow links from seed
// Return = top results immediately

const watchTsla: FeedSourceConfig = {
	id: 'watch-tsla-web',
	kind: 'web-crawl',
	title: 'Tesla News (Deep Crawl)',

	// Start here
	seedUrls: ['https://news.google.com/search?q=TSLA', 'https://www.bing.com/news/search?q=Tesla'],

	// Search query
	query: 'TSLA Tesla stock news',

	// Crawl strategy
	crawlDepth: 3, // 1=shallow, 3=deep
	crawlMaxPages: 50, // Max pages to fetch
	crawlEngine: 'cheerio',

	// Caching
	pollMinutes: 30, // Update every 30 min
	maxItems: 15, // Show 15 items max

	// Behavior
	sameDomainOnly: false, // Follow to news sites
	tags: ['stocks', 'tesla'],
};
```

---

## Testing Locally

```bash
# Start dev server
pnpm dev

# Test fast crawl (2 sec max)
curl http://localhost:3000/api/feeds?columnId=watch-tsla-web
# Returns immediately with top items

# Check background progress
curl http://localhost:3000/api/health
# Shows active crawl tasks and metrics

# Wait 30 seconds, then refresh
# Next request returns more items from deep crawl cache
curl http://localhost:3000/api/feeds?columnId=watch-tsla-web
```

---

## Next Steps

1. **Implement two-tier crawl** — Split `crawlFast()` and `crawlDeep()`
2. **Fire background task** — Use `Promise.catch()` to avoid blocking response
3. **Merge results** — Update cache with deep crawl results
4. **Monitor progress** — Track metrics and log to monitoring system
5. **Tune parameters** — Adjust `crawlDepth`, `maxPages`, rate limits

This approach ensures users always get fast responses while progressively discovering more content in the background.
