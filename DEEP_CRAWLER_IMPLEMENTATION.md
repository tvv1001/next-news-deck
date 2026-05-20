# Deep Crawler Implementation Guide

## What You're Building

A crawler that:

1. **Responds in <2 seconds** with the best results found so far
2. **Keeps crawling for 60+ seconds** in the background discovering more content
3. **Caches everything** so the next request gets all previous discoveries
4. **Respects rate limits** to avoid hammering domains

---

## Quick Start: 3 Steps

### Step 1: Create Fast Crawl Function

Add this to `lib/feeds/web-crawl.ts`:

```typescript
/**
 * Fast crawl: return within 2 seconds with top results
 * Used for immediate response to user/dashboard
 */
async function crawlFast(source: FeedSourceConfig, tokens: string[], maxSeconds: number = 2): Promise<ExtractedPage[]> {
	const startTime = Date.now();
	const maxDurationMs = maxSeconds * 1000;
	const results: ExtractedPage[] = [];

	// Crawl seed URLs with strict time limit
	for (const seedUrl of source.seedUrls ?? []) {
		// Abort if time exceeded
		if (Date.now() - startTime > maxDurationMs) {
			break;
		}

		try {
			// Fetch and extract seed page
			const page = await fetchAndExtractPage(seedUrl, source, tokens);
			if (page && !shouldRejectPage(page.url, page.title, page.summary, page.text, page.publishedAt)) {
				results.push(page);
			}

			// Follow top 3 links only (fast path)
			const topLinks = page?.links.slice(0, 3) ?? [];
			for (const link of topLinks) {
				if (Date.now() - startTime > maxDurationMs) {
					break;
				}

				try {
					const subpage = await fetchAndExtractPage(link, source, tokens);
					if (subpage && !shouldRejectPage(subpage.url, subpage.title, subpage.summary, subpage.text, subpage.publishedAt)) {
						results.push(subpage);
					}
				} catch (err) {
					// Skip individual link errors in fast crawl
					console.debug(`Fast crawl: skipped ${link}`, err instanceof Error ? err.message : String(err));
				}
			}
		} catch (err) {
			console.warn(`Fast crawl failed for ${seedUrl}:`, err instanceof Error ? err.message : String(err));
		}
	}

	// Return top items by score
	return results.sort((a, b) => b.score - a.score).slice(0, 15); // Return top 15 for caching
}

/**
 * Deep crawl: explore all links, no time limit
 * Runs in background after fast crawl returns
 */
async function crawlDeep(source: FeedSourceConfig, tokens: string[]): Promise<ExtractedPage[]> {
	const maxDepth = source.crawlDepth ?? 2;
	const maxPages = source.crawlMaxPages ?? 50;

	const queue: CrawlQueueItem[] = (source.seedUrls ?? []).map((url) => ({
		url,
		depth: 0,
	}));

	const visited = new Set<string>();
	const results: ExtractedPage[] = [];

	while (queue.length > 0 && results.length < maxPages) {
		const item = queue.shift();
		if (!item) break;

		const { url, depth } = item;

		// Skip if already visited or depth exceeded
		if (visited.has(url) || depth >= maxDepth) {
			continue;
		}

		visited.add(url);

		try {
			// Rate limit before fetching
			await RATE_LIMITER.waitForSlot(url);

			try {
				// Fetch and extract page
				const page = await fetchAndExtractPage(url, source, tokens);
				if (page && !shouldRejectPage(page.url, page.title, page.summary, page.text, page.publishedAt)) {
					results.push(page);

					// Add all links to queue for deeper exploration
					if (depth + 1 < maxDepth) {
						for (const link of page.links) {
							if (!visited.has(link)) {
								queue.push({
									url: link,
									depth: depth + 1,
								});
							}
						}
					}
				}
			} finally {
				RATE_LIMITER.release(url);
			}
		} catch (err) {
			console.warn(`Deep crawl failed for ${url}:`, err instanceof Error ? err.message : String(err));
		}
	}

	return results;
}
```

### Step 2: Update Main Export Function

Replace the existing `fetchWebCrawlSource` export:

```typescript
// Track background crawls
const backgroundCrawlPromises = new Map<string, Promise<void>>();

/**
 * Main entry point: returns fast results immediately,
 * queues deep crawl in background
 */
export async function fetchWebCrawlSource(source: FeedSourceConfig): Promise<FeedSourceResult> {
	if (source.kind !== 'web-crawl') {
		throw new Error(`Source ${source.id} is not a web crawl source.`);
	}

	const seedUrls = source.seedUrls?.filter(Boolean) ?? [];
	if (seedUrls.length === 0) {
		throw new Error(`Web crawl source ${source.id} requires at least one seed URL.`);
	}

	const tokens = tokenizeQuery(source.query);
	const fetchedAt = new Date().toISOString();

	// ============================================
	// TIER 1: FAST CRAWL (blocks, ~2 seconds)
	// ============================================
	const fastMatches = await crawlFast(source, tokens, 2);
	const rankedMatches = fastMatches.sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}
		return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
	});
	const balancedMatches = limitPagesPerDomain(rankedMatches, DEFAULT_MAX_ITEMS_PER_DOMAIN);
	const items = dedupeAndSortFeedItems(balancedMatches.map((page) => toFeedItem(page, source))).slice(0, source.maxItems);

	const staleAt = new Date(Date.now() + source.pollMinutes * 60_000).toISOString();

	// ============================================
	// TIER 2: DEEP CRAWL (background, no await)
	// ============================================
	const crawlPromise = crawlDeepInBackground(source, tokens)
		.catch((err) => console.error(`Background crawl failed for ${source.id}:`, err))
		.finally(() => backgroundCrawlPromises.delete(source.id));

	backgroundCrawlPromises.set(source.id, crawlPromise);

	// Return immediately with fast results
	return {
		source,
		items,
		fetchedAt,
		staleAt,
	};
}

/**
 * Background task: performs deep crawl and updates cache
 * Called asynchronously (doesn't block response)
 */
async function crawlDeepInBackground(source: FeedSourceConfig, tokens: string[]): Promise<void> {
	const startTime = Date.now();

	try {
		// Perform deep crawl (60-180 seconds)
		const deepMatches = await crawlDeep(source, tokens);

		// Rank results
		const rankedMatches = deepMatches.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
		});

		// Balance by domain (allow more per domain in deep crawl)
		const balancedMatches = limitPagesPerDomain(rankedMatches, 8);

		// Convert to feed items
		const newItems = dedupeAndSortFeedItems(balancedMatches.map((page) => toFeedItem(page, source))).slice(0, source.maxItems * 2); // Allow 2x items in cache

		// Update cache with new results
		const cacheKey = `feed-source:${source.id}`;
		const fetchedAt = new Date().toISOString();
		const staleAt = new Date(Date.now() + source.pollMinutes * 60_000).toISOString();

		await getCachedValue(
			cacheKey,
			source.pollMinutes * 60_000,
			async () => ({
				source,
				items: newItems,
				fetchedAt,
				staleAt,
			}),
			{
				forceRefresh: true, // Update cache immediately
			},
		);

		const elapsed = Date.now() - startTime;
		console.log(`✓ Deep crawl completed for ${source.id} in ${elapsed}ms: ${newItems.length} items`);
	} catch (err) {
		console.error(`✗ Deep crawl failed for ${source.id}:`, err);
	}
}

/**
 * Check active background crawls (for monitoring)
 */
export function getActiveBackgroundCrawls(): string[] {
	return Array.from(backgroundCrawlPromises.keys());
}
```

### Step 3: Configure Your Source

Update `lib/config/default-columns.ts` to set crawl parameters:

```typescript
const watchTslaWeb: FeedSourceConfig = {
	id: 'watch-tsla-web',
	kind: 'web-crawl',
	title: 'Watch TSLA',
	description: 'Deep web crawl for Tesla news',
	siteUrl: 'https://news.google.com',
	feedUrl: 'https://news.google.com',
	pollMinutes: 30, // Crawl every 30 minutes
	maxItems: 12, // Show 12 items in dashboard
	seedUrls: ['https://news.google.com/search?q=TSLA', 'https://www.bing.com/news/search?q=Tesla'],
	crawlDepth: 3, // 1=shallow, 2=medium, 3=deep
	crawlMaxPages: 60, // Max pages to crawl in background
	sameDomainOnly: false, // Follow to different domains
	crawlEngine: 'cheerio',
	tags: ['stocks', 'tesla'],
	query: 'TSLA Tesla stock news',
};
```

---

## How It Works in Practice

### Request Timeline

```
T+0ms   ← GET /api/feeds?columnId=watch-tsla-web

T+100ms   → FastCrawl starts
          ├─ Fetch seed URL #1 (Google News search)
          ├─ Extract top 3 links
          └─ Fetch those 3 links

T+1500ms  ← FastCrawl completes (15 items found)
          → Response sent to dashboard
          → DeepCrawl starts (background, no await)

          DeepCrawl continues...
          ├─ T+1500ms: Process seed URL #2 (Bing)
          ├─ T+3000ms: Follow 30+ links discovered
          ├─ T+45000ms: Process depth=2 links
          └─ T+90000ms: Complete (50 items total)

T+1505ms  ← Dashboard receives 15 items, user sees results

T+95000ms → Cache updated with 50 items
          → Next request (T+120000ms) gets all 50 items
```

### User Experience

**First visit:**

- ✅ Fast: Results appear in ~1.5 seconds
- Items are highest quality (fast crawl focused on ranking)

**Refresh in 2 minutes:**

- ✅ More items: 50 total (fast + deep crawl)
- New discoveries added to feed
- Still fast because cached

**Refresh after 30 minutes:**

- ✅ Fresh crawl starts (cache expired)
- Repeat: Fast results → Background deep crawl

---

## Monitoring Progress

### Check Active Crawls

```bash
# See which sources are being crawled
curl http://localhost:3000/api/health | jq .crawling
```

### Add Logging

```typescript
// lib/feeds/web-crawl.ts

// Add at top
const crawlStartTime = new Map<string, number>();

// In crawlFast
console.log(`⚡ Fast crawl started for ${source.id}`);
const fastStart = Date.now();
// ... crawl code ...
console.log(`⚡ Fast crawl done for ${source.id} in ${Date.now() - fastStart}ms`);

// In crawlDeep
console.log(`🔍 Deep crawl starting for ${source.id}`);
crawlStartTime.set(source.id, Date.now());
// ... crawl code ...
const duration = Date.now() - crawlStartTime.get(source.id)!;
console.log(`🔍 Deep crawl done for ${source.id} in ${duration}ms: ${results.length} items`);
```

---

## Tuning Parameters

### Fast Crawl

```typescript
// In crawlFast(source, tokens, 2)
// ^^^^^^^ seconds timeout
// If you want faster response: use 1
// If you want more initial results: use 3
```

### Deep Crawl

```typescript
// In lib/config/default-columns.ts
crawlDepth: 3,        // How many levels deep?
                      // 1 = seeds only
                      // 2 = seeds + their links
                      // 3 = 2 levels deep

crawlMaxPages: 60,    // Max pages total
                      // Higher = more comprehensive
                      // Lower = faster background crawl
```

### Rate Limiting

```typescript
// In lib/feeds/domain-rate-limiter.ts
new DomainRateLimiter(
	300, // ms between requests per domain
	// Higher = more polite (slower crawl)
	// Lower = faster but more aggressive

	2, // concurrent domains
	// Higher = faster overall crawl
	// Lower = less resource usage
);
```

---

## Testing

```bash
# Start dev server
pnpm dev

# Test fast crawl response (should be <2 seconds)
time curl http://localhost:3000/api/feeds?columnId=watch-tsla-web

# Check number of items returned
curl http://localhost:3000/api/feeds?columnId=watch-tsla-web | jq '.items | length'

# Check server logs for crawl progress
# Look for ⚡ and 🔍 logs

# Wait 2-3 minutes, check again
# Should see more items as deep crawl completes
```

---

## Result

You now have:

✅ **Responsive UI** — Fast response (<2 sec), users see results immediately ✅ **Comprehensive content** — Deep crawl finds 50+ items in background ✅ **Efficient caching** — Results cached for 30 minutes ✅ **Rate limiting** — Respects domain limits while exploring ✅ **Monitoring** — Track progress in logs and /api/health

The crawler will explore breadth (all seed links) then depth (follow promising links deeper) while always returning fast results to the user.
