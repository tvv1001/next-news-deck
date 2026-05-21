import { getCachedValue } from '@/lib/cache/feed-cache';
import { publishFeedSourceUpdate } from '@/lib/feeds/live-updates';
import { fetchRedditSource } from '@/lib/feeds/reddit';
import { fetchRssSource } from '@/lib/feeds/rss';
import { fetchWebCrawlSource } from '@/lib/feeds/web-crawl';
import { FeedSourceConfig, FeedSourceResult, FeedSourceTestResult } from '@/lib/feeds/types';

export async function fetchSourcePayload(source: FeedSourceConfig): Promise<FeedSourceResult> {
	try {
		if (source.kind === 'web-crawl') {
			return await fetchWebCrawlSource(source);
		}

		if (source.kind === 'reddit') {
			return await fetchRedditSource(source);
		}

		return await fetchRssSource(source);
	} catch (error) {
		const fetchedAt = new Date().toISOString();

		return {
			source,
			items: [],
			fetchedAt,
			staleAt: new Date(Date.now() + 2 * 60_000).toISOString(),
			error: {
				sourceId: source.id,
				message: error instanceof Error ? error.message : 'Unexpected feed ingestion error.',
				retryable: true,
			},
		};
	}
}

export async function getSourceResult(source: FeedSourceConfig) {
	const cacheKey = `feed-source:${source.id}`;
	const ttlMs = source.pollMinutes * 60_000;
	const isBackgroundCrawl = source.kind === 'web-crawl';

	return getCachedValue(cacheKey, ttlMs, () => fetchSourcePayload(source), {
		staleWhileRevalidateMs: isBackgroundCrawl ? 8 * 60_000 : 0,
		refreshInBackground: isBackgroundCrawl,
		onValueStored: (previousValue, nextValue) => {
			publishFeedSourceUpdate(previousValue, nextValue);
		},
	});
}

export async function testFeedSource(source: FeedSourceConfig): Promise<FeedSourceTestResult> {
	const startedAt = Date.now();
	const result = await fetchSourcePayload(source);
	const testedAt = new Date().toISOString();

	return {
		sourceId: source.id,
		sourceTitle: source.title,
		kind: source.kind,
		ok: !result.error,
		testedAt,
		durationMs: Date.now() - startedAt,
		itemCount: result.items.length,
		fetchedAt: result.fetchedAt,
		staleAt: result.staleAt,
		error: result.error?.message,
		sampleTitles: result.items.slice(0, 3).map((item) => item.title),
		sampleUrls: result.items.slice(0, 3).map((item) => item.url),
	};
}
