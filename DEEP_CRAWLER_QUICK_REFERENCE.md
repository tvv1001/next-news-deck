# Deep Crawler: Quick Reference Card

## TL;DR

Build a crawler that returns results in **1.5 seconds** while continuing to crawl deeply in the **background**.

```
Fast Path (Immediate)     Deep Path (Background)
────────────────────      ──────────────────────
Fetch seed URLs    ────▶  ✅ Return to user
Extract top links         (items appear on screen)
Score & rank
                         Meanwhile:
≈2 seconds               Start deep crawl
                         Follow all links
                         Explore 2-3 levels
                         Score all pages

                         ≈90 seconds
                         Update cache
                         Next request gets all items
```

---

## Three Guides

| Guide                            | Purpose                     | Read When               |
| -------------------------------- | --------------------------- | ----------------------- |
| `DEEP_CRAWLER_ARCHITECTURE.md`   | Full system design          | Understanding the "why" |
| `DEEP_CRAWLER_IMPLEMENTATION.md` | Code examples ready to copy | Ready to write code     |
| `DEEP_CRAWLER_VISUAL_GUIDE.md`   | Diagrams & timelines        | Seeing how it flows     |

---

## Copy-Paste Implementation

### Step 1: Add two functions to `lib/feeds/web-crawl.ts`

From **DEEP_CRAWLER_IMPLEMENTATION.md → Step 1**, copy:

- `crawlFast()` function (30 lines)
- `crawlDeep()` function (50 lines)

### Step 2: Replace export function

Replace `fetchWebCrawlSource()` with code from **Step 2** (60 lines)

### Step 3: Configure source

Update `lib/config/default-columns.ts`:

```typescript
{
  id: 'watch-tsla-web',
  crawlDepth: 3,        // Levels deep
  crawlMaxPages: 60,    // Max pages
  seedUrls: [...],      // Starting URLs
  query: 'TSLA Tesla',  // Search terms
}
```

---

## Validate

```bash
pnpm typecheck  # ✅ Should pass
pnpm build      # ✅ Should succeed
pnpm dev        # Start server
```

```bash
# Test fast response (should be < 2 sec)
curl http://localhost:3000/api/feeds?columnId=watch-tsla-web

# Wait 90 seconds, test again
# Should show more items from cache
```

---

## How It Works

### User Request

```
GET /api/feeds?columnId=watch-tsla-web
```

### Server Response

```
T+0-2000ms:
  ├─ Run crawlFast()
  ├─ Extract top items
  └─ Return to user

T+2000ms+:
  ├─ User gets response
  ├─ Dashboard shows items
  └─ crawlDeepInBackground() continues

T+90000ms:
  ├─ Deep crawl completes
  ├─ Cache updated
  └─ Next request gets all items
```

### What User Sees

```
T+1.5s   ✅ Results appear (15 items)
T+90s    ✅ More items if they scroll/refresh (50 total)
```

---

## Key Code Patterns

### Fast Crawl (in Step 1)

```typescript
async function crawlFast(source, tokens, maxSeconds = 2) {
	const startTime = Date.now();
	const maxDurationMs = maxSeconds * 1000;
	// Fetch seeds + top 3 links each
	// Return when time expires
}
```

### Deep Crawl (in Step 1)

```typescript
async function crawlDeep(source, tokens) {
	const queue = seedUrls.map((url) => ({ url, depth: 0 }));
	while (queue.length > 0 && results.length < maxPages) {
		// Pop from queue
		// Fetch page
		// Add new links to queue (for deeper exploration)
		// Rate limit per domain
	}
	return results;
}
```

### Main Function (in Step 2)

```typescript
export async function fetchWebCrawlSource(source) {
  // Tier 1: Fast crawl (blocks)
  const fastItems = await crawlFast(source);

  // Return immediately
  return { source, items: fastItems, ... };

  // Tier 2: Deep crawl (fire and forget)
  crawlDeepInBackground(source).catch(...);
}
```

---

## Parameters to Tune

```typescript
// In crawlFast()
maxSeconds: 2; // How long fast crawl runs
// 1 = very fast, fewer items
// 2 = balanced
// 3 = slower but more initial items

// In crawlDeep()
crawlDepth: 3; // How many levels to explore
// 1 = seed URLs only
// 2 = seed + their links
// 3 = 2 levels deep

crawlMaxPages: 60; // Max pages total
// 30 = quick background crawl
// 60 = balanced
// 100 = comprehensive

// In DomainRateLimiter
300; // ms between requests per domain
// 100 = faster, more aggressive
// 300 = balanced, polite
// 1000 = very polite, very slow
```

---

## Expected Performance

| Metric                | Value         |
| --------------------- | ------------- |
| Fast crawl time       | 1-2 seconds   |
| Response time         | < 2.5 seconds |
| Deep crawl time       | 60-90 seconds |
| Items from fast crawl | 10-15         |
| Items from deep crawl | 40-50         |
| Requests per domain   | ≤ 8           |
| Domain rate limit     | 300ms         |
| Concurrent domains    | 2             |
| Cache duration        | 30 minutes    |

---

## Monitoring

### Check Logs

```
⚡ Fast crawl started for watch-tsla-web
⚡ Fast crawl done in 1523ms: 15 items
🔍 Deep crawl starting for watch-tsla-web
🔍 Deep crawl done in 87234ms: 50 items
```

### Health Endpoint

```bash
curl http://localhost:3000/api/health | jq .crawling
```

Returns:

```json
{
  "activeTasks": 1,
  "recentMetrics": [...]
}
```

---

## Common Tweaks

**"Results are coming back too slowly"** → Decrease `maxSeconds` in crawlFast() from 2 to 1

**"I'm not getting enough initial items"** → Increase `maxSeconds` in crawlFast() from 2 to 3

**"Deep crawl not finding enough results"** → Increase `crawlDepth` from 2 to 3 → Increase `crawlMaxPages` from 50 to 100

**"Crawler is hammering the server too hard"** → Increase DomainRateLimiter from 300 to 500 ms → Decrease maxConcurrentDomains from 2 to 1

**"Cache is stale"** → Decrease `pollMinutes` from 30 to 15

---

## Files Modified

```
lib/feeds/web-crawl.ts
  ├─ Add crawlFast()
  ├─ Add crawlDeep()
  ├─ Add crawlDeepInBackground()
  ├─ Add getActiveBackgroundCrawls()
  └─ Replace fetchWebCrawlSource()

lib/config/default-columns.ts
  └─ Add crawlDepth, crawlMaxPages to watch-tsla-web
```

No changes to:

- types.ts (feed shapes)
- feed-cache.ts (caching)
- domain-rate-limiter.ts (rate limiting)
- API routes
- Dashboard components

---

## From Copy-Paste to Working

```bash
# 1. Copy code from IMPLEMENTATION.md
#    (6 minutes)

# 2. Run validation
pnpm typecheck && pnpm build
#    (2 minutes)

# 3. Start dev server
pnpm dev
#    (1 minute)

# 4. Test
curl http://localhost:3000/api/feeds?columnId=watch-tsla-web
#    (1 minute)

# 5. Observe logs
#    See ⚡ (fast) then 🔍 (deep) progress
#    (2 minutes)

Total: ~12 minutes from start to working system
```

---

## Success Checkpoints

- [ ] TypeScript checks pass
- [ ] Build completes successfully
- [ ] Fast crawl returns in < 2 seconds
- [ ] Items appear on dashboard immediately
- [ ] Logs show `⚡ Fast crawl done` message
- [ ] Logs show `🔍 Deep crawl starting` message
- [ ] Deep crawl completes (90 sec)
- [ ] Logs show `✓ Deep crawl completed`
- [ ] Refresh returns more items from cache
- [ ] Cache expires after 30 minutes (or configured time)

---

## Next: Actual Implementation

👉 **Open: DEEP_CRAWLER_IMPLEMENTATION.md** 👉 **Copy: Step 1-3 code to web-crawl.ts** 👉 **Run: pnpm typecheck && pnpm build** 👉 **Test: curl the endpoint**

The guides above are reference - the implementation guide has the exact code.
