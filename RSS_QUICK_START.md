# Quick Start: RSS Export Features

## 🚀 What You Can Do Now

### 1. Share Any Column as RSS

```
http://localhost:3000/api/feeds/export/tech-radar
```

**Available columns:**

- `tech-radar` — Tech Radar (TechCrunch, The Verge, others)
- `top-stories` — Top Stories (BBC, NPR)
- `watch-tsla-web` — Crawl watch lane (TSLA)
- `reddit-technology` — Reddit Tech
- `reddit-programming` — Reddit Programming
- `reddit-worldnews` — Reddit World News

### 2. Backup All Feed Subscriptions

```
http://localhost:3000/api/feeds/export/opml
```

Download to back up all your feed sources, then import into another reader.

---

## 📱 Subscribe in Your Reader

### Feedly

1. Click **Add Content** → **Add by URL**
2. Paste: `http://localhost:3000/api/feeds/export/column.xml?columnId=technology`
3. Choose a collection → **Add**

### Apple News+ (if available)

1. Tap **Add** → **Enter RSS Feed URL**
2. Paste the column RSS URL
3. Done

### Inoreader

1. Click **Add subscription**
2. Paste RSS URL
3. Select folder → **Subscribe**

### NetNewsWire

1. File → **New Feed** (or click ⊕)
2. Paste RSS URL
3. Choose folder → **Add**

### Other readers

Any RSS-compatible reader works: Reeder, The Unread, Read It Later, etc.

---

## 🔧 For Developers

### Create custom RSS exports

```typescript
// In your Next.js route
import { generateRssXml } from '@/lib/feeds/rss-generator';

export async function GET() {
  const items = [...]; // your items

  const xml = generateRssXml(items, {
    title: 'My Feed',
    description: 'Custom feed',
    link: 'http://localhost:3000'
  });

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml' }
  });
}
```

### Export OPML

```typescript
import { generateOpmlXml } from '@/lib/feeds/rss-generator';

const xml = generateOpmlXml(sources, 'My Subscriptions');
```

---

## 🧪 Testing

```bash
# Run integration tests
npx ts-node scripts/test-rss-export.ts
```

---

## ⚙️ Configuration

RSS exports use these environment variables:

- `NEWS_DECK_RSS_ARTICLE_TIMEOUT_MS` — per-article fetch timeout
- `NEWS_DECK_RSS_MIN_CONTENT_CHARS` — minimum article length

Cache:

- Column RSS: 5-minute cache
- OPML: 1-hour cache

---

## 🐛 Troubleshooting

**Feed not updating:**

- Check browser cache (Ctrl+Shift+R to refresh)
- Verify source is fetching in `/api/health`
- Reload feed in your reader

**Bad XML error:**

- Make sure columnId is valid (see list above)
- Check Next.js console for error messages
- Verify dev server is running

**Feed reader can't parse:**

- Try a different reader (to rule out reader-specific issues)
- Test URL directly: `curl http://localhost:3000/api/feeds/export/column.xml?columnId=technology`
- Should see `<?xml version="1.0"...`

---

## 📚 Read More

- [RSS Export Implementation Details](./RSS_EXPORT_IMPLEMENTATION.md)
- [Custom RSS Server Analysis](./CUSTOM_RSS_SERVER_ANALYSIS.md)
- [Architecture Overview](./README.md#architecture)
