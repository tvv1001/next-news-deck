# Deep Crawler: Visual Guide

## The Problem You're Solving

```
Old Approach (Blocking Crawl):
┌────────────────────────────────────────────────────────┐
│ User requests: GET /api/feeds?columnId=watch-tsla     │
│                                                        │
│ Server: "Let me crawl deeply... this might take       │
│         30-60 seconds"                                 │
│                                                        │
│ ⏳ 30+ seconds pass (user sees loading spinner)        │
│ ⏳ Eventually get 50 items (but user already left!)    │
│                                                        │
│ ❌ Bad UX: Slow to respond                             │
│ ❌ Uncertain: How long will it take?                   │
│ ❌ Not scalable: Each request blocks server thread     │
└────────────────────────────────────────────────────────┘

New Approach (Fast + Background):
┌─────────────────────────────────┐
│ User requests feed              │
│                                 │
│ ⚡ Fast crawl starts (2 sec)    │
│ ├─ Seed URL 1                   │
│ ├─ Seed URL 2                   │
│ └─ Top 3 links from each        │
│                                 │
│ ✅ 1.5 seconds: 15 items found  │
│    Response sent to user        │
│    Dashboard updates!           │
│                                 │
│ 🔍 Deep crawl starts (background)
│    (doesn't block response)
│    ├─ Follows ALL discovered links
│    ├─ Explores 2-3 levels deep
│    └─ Finds 50+ total items
│                                 │
│ ✅ 90 seconds later: Cache updated
│    Next request gets all 50 items
└─────────────────────────────────┘
```

---

## Request-Response Timeline

```
Timeline (milliseconds):

T+0     ┌─ Request arrives
        │
T+100   │  Fast Crawl
        │  ├─ Fetch seed #1 (Google News)
        │  ├─ Extract content + links
T+600   │  │
        │  ├─ Fetch seed #2 (Bing)
T+1200  │  │
        │  ├─ Follow top 3 links
T+1500  │  └─ Done! 15 items ranked
        │
        ├─ 🔥 START Background Deep Crawl
        ├─ 🔥 (continues without waiting)
        │
T+1505  │  ✅ RESPONSE SENT
        │     [{"title":"...", "url":"..."}]
        │
        │  Meanwhile, background continues...
        │  🔍 Process link depth=1 (20 pages)
        │  🔍 Process link depth=2 (30 pages)
        │  🔍 Score & dedupe (50 items total)
T+90000 │  🔍 Update cache
        │
T+120000│  User refreshes
        │  ✅ RESPONSE with 50 items (cached)
```

---

## Code Flow Diagram

```
fetchWebCrawlSource()
│
├─ Input: FeedSourceConfig
│  ├─ seedUrls: ["google.com/news/...", "bing.com/news/..."]
│  ├─ crawlDepth: 3
│  ├─ query: "TSLA"
│  └─ maxItems: 15
│
├─ 🟢 TIER 1: FAST CRAWL (2 second timeout)
│  │
│  ├─ For each seedUrl:
│  │  ├─ Fetch HTML
│  │  ├─ Extract: title, summary, links
│  │  ├─ Score content (relevance, freshness)
│  │  │
│  │  └─ For each top 3 links:
│  │     ├─ Fetch HTML
│  │     ├─ Extract content
│  │     └─ Score
│  │
│  ├─ Sort by score
│  └─ Return top 15 items
│
├─ ✅ Return immediately (< 2 seconds)
│  │
│  └─ Response: FeedSourceResult
│     ├─ items: [15 best items]
│     └─ fetchedAt: timestamp
│
├─ 🟠 TIER 2: DEEP CRAWL (background, no await)
│  │
│  ├─ Create queue of all links found
│  ├─ While queue not empty AND pages < 60:
│  │  │
│  │  ├─ Pop URL from queue
│  │  ├─ Check if visited (skip if yes)
│  │  ├─ Rate limit (wait for domain slot)
│  │  │
│  │  ├─ Fetch page
│  │  ├─ Extract content + links
│  │  ├─ Score page
│  │  │
│  │  ├─ Add new links to queue
│  │  │  (for depth+1 exploration)
│  │  │
│  │  └─ Repeat
│  │
│  └─ When done:
│     └─ Update cache with 50 items
│
└─ Next request (after cache expires)
   ├─ Gets 50 items from cache
   └─ Cycle repeats
```

---

## What Happens in Each Tier

### TIER 1: Fast Crawl (⚡ 2 seconds)

```
Goal: Return SOMETHING quickly

┌─────────────────────────────────┐
│ Seed URL #1                     │
│ news.google.com/search?q=TSLA   │
│                                 │
│ HTML loaded                     │
│ ├─ Extract content              │
│ ├─ Find all links (50+)         │
│ ├─ Sort by relevance            │
│ └─ Take TOP 3                   │
│                                 │
│ Follow top 3 links              │
│ ├─ newssite1.com/article/123    │
│ ├─ newssite2.com/article/456    │
│ └─ newssite3.com/article/789    │
│                                 │
│ Extract + score each            │
│                                 │
│ [Now we have ~4 pages]          │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Seed URL #2                     │
│ bing.com/news/search?q=Tesla    │
│                                 │
│ HTML loaded                     │
│ ├─ Top 3 links extracted        │
│ └─ Each fetched + scored        │
│                                 │
│ [Now we have ~8 pages]          │
└─────────────────────────────────┘

✅ TIME CHECK: 1.5 seconds elapsed
   ✅ Return 15 best items
   ✅ User sees results
```

### TIER 2: Deep Crawl (🔍 60-90 seconds, background)

```
Goal: Find MORE content, don't rush

Queue initialized with:
├─ google.com/search/...  (depth=0)
├─ bing.com/news/...      (depth=0)
└─ [all links discovered] (depth=1)

Process queue (BFS):
┌────────────────────────────────────┐
│ Depth 0 (2 URLs)                   │
├────────────────────────────────────┤
│ Pop google.com/search/...          │
│ └─ Extract 50+ links               │
│    └─ Add to queue (depth=1)       │
│                                    │
│ Pop bing.com/news/...              │
│ └─ Extract 50+ links               │
│    └─ Add to queue (depth=1)       │
└────────────────────────────────────┘

Queue now has 100 URLs at depth=1

┌────────────────────────────────────┐
│ Depth 1 (20 URLs from each seed)   │
├────────────────────────────────────┤
│ Pop newssite1.com/article/123      │
│ └─ Extract 10+ links               │
│    └─ Add to queue (depth=2)       │
│                                    │
│ Pop newssite2.com/article/456      │
│ └─ Extract 10+ links               │
│    └─ Add to queue (depth=2)       │
│                                    │
│ [continue for 20 URLs...]          │
└────────────────────────────────────┘

Queue now has 200 URLs at depth=2

┌────────────────────────────────────┐
│ Depth 2 (200 URLs)                 │
├────────────────────────────────────┤
│ Rate limit: Wait 300ms per domain  │
│ Score each page                    │
│ Stop when maxPages (60) reached     │
│                                    │
│ [Process ~40 more pages]           │
└────────────────────────────────────┘

✅ TIME: 90 seconds total
   ✅ 50 total items found
   ✅ Cache updated
   ✅ Next request gets all 50
```

---

## Rate Limiting During Deep Crawl

```
How to avoid hammering domains:

Domain: cnn.com
├─ Request 1: Fetch homepage ✓
│  └─ Wait 300ms (rate limit)
├─ Request 2: Fetch article ✓
│  └─ Wait 300ms
├─ Request 3: Fetch article ✓
│  └─ Wait 300ms
├─ Request 4: Fetch article ✓
│  └─ Wait 300ms
├─ Request 5: Fetch article ✓
│  └─ Wait 300ms
├─ Request 6: Fetch article ✓
│  └─ Wait 300ms
├─ Request 7: Fetch article ✓
│  └─ Wait 300ms
├─ Request 8: MAX REACHED ✗
│  └─ Skip (domain budget exhausted)
└─ Total: 2.1 seconds (very polite)

Domain: reuters.com
├─ Request 1-8: Same pattern
└─ Interleaved with cnn.com

Concurrency: Max 2 domains at once
├─ While waiting for cnn.com (300ms)
└─ Fetch from reuters.com in parallel
```

---

## Cache Behavior

```
Timeline:

T+0     Fast request arrives
        └─ No cache hit
        └─ Fast crawl executes (2 sec)
        └─ Returns 15 items
        └─ Cache: 15 items (pollMinutes=30)

T+1505  Response sent, deep crawl starts

T+90000 Deep crawl completes
        └─ Cache updated: 50 items

T+120000 User refreshes
        └─ Cache HIT: 50 items
        └─ Return immediately
        └─ Queue new deep crawl

T+1800000 Cache expires (30 min)
        └─ Cache MISS
        └─ Fast crawl executes again
        └─ Cycle repeats
```

---

## Scoring & Ranking

```
Page Score = Relevance + Freshness + Authority

For each page:

1. Relevance Score (0-100)
   ├─ Does title match query "TSLA"?  (+20 if yes)
   ├─ Does content mention "Tesla"?   (+15 if yes)
   ├─ Content length > 300 chars?     (+10 if yes)
   ├─ Has publication date?           (+10 if yes)
   └─ Total: 0-55 points

2. Freshness Score (0-30)
   ├─ Published today?                (+30)
   ├─ Published this week?            (+15)
   ├─ Published this month?           (+5)
   └─ Older than 10 days?             (-10, rejected)

3. Authority Score (0-15)
   ├─ From trusted domain (CNN, Reuters)? (+15)
   ├─ From news aggregator (Google)?  (+10)
   ├─ From independent blog?          (+5)
   └─ From spam/ads?                  (-20, rejected)

Final Score = Relevance + Freshness + Authority
            = 0-100 range

Sort by score (highest first)
Return top 15-50
```

---

## User See-Through

### What User Sees

```
GET /api/feeds?columnId=watch-tsla-web
TIME: T+0

    [loading spinner]
    ⏳ Fetching news...

TIME: T+1.5 seconds
✅ Results appear!

┌─────────────────────────────┐
│ Tesla Q1 Earnings Beat      │ Score: 92
│ Time: 2 hours ago           │
├─────────────────────────────┤
│ Elon Announces New Model    │ Score: 88
│ Time: 4 hours ago           │
├─────────────────────────────┤
│ Stock Rises 5% on News      │ Score: 85
│ Time: Just now              │
├─────────────────────────────┤
│ [11 more items...]          │
└─────────────────────────────┘

Meanwhile (server side):
🔍 Deep crawl in background...
└─ Found: 50 total items
└─ Cache updated

TIME: T+120 seconds
📲 User refreshes (or new session)
✅ Same 15 items visible
   (but more available if scrolling)
```

---

## Performance Checklist

```
✅ Response Time
   ├─ Fast crawl: 1-2 seconds
   ├─ Response sent: < 2.5 seconds
   └─ Dashboard shows items immediately

✅ Content Quality
   ├─ Initial 15 items: best quality (highest score)
   ├─ Deep crawl 50 items: comprehensive
   └─ No spam/ads in results

✅ Server Impact
   ├─ Fast crawl: 1 thread, 2 seconds
   ├─ Deep crawl: background, non-blocking
   └─ Other requests unaffected

✅ Domain Politeness
   ├─ Rate limit: 300ms per request
   ├─ Max 8 requests per domain
   ├─ 2 concurrent domains max
   └─ Respect robots.txt? (TODO: add)

✅ Resource Usage
   ├─ Memory: Items cached in Redis
   ├─ Bandwidth: Smart link selection
   ├─ CPU: Fast crawl optimized
   └─ Network: Parallel when possible
```

This architecture gives you:

- ✅ Fast user response
- ✅ Comprehensive content
- ✅ Scalable (background doesn't block)
- ✅ Respectful (rate limiting)
- ✅ Observable (logs & metrics)
