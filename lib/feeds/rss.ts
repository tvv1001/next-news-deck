import Parser from 'rss-parser';

import { fetchArticleText } from '@/lib/feeds/article-content';
import { normalizeFeedItem, type ParsedFeedItem, truncate } from '@/lib/feeds/normalize';
import { DomainRateLimiter } from '@/lib/feeds/domain-rate-limiter';
import { FeedItem, FeedSourceConfig, FeedSourceResult } from '@/lib/feeds/types';

const parser = new Parser<Record<string, never>, ParsedFeedItem>();
const DEFAULT_ARTICLE_TIMEOUT_MS = 8_000;
const DEFAULT_MIN_CONTENT_CHARS = 360;
const DEFAULT_CONCURRENCY = 4;
const RATE_LIMITER = new DomainRateLimiter(300, 2);

function buildHeaders(source: FeedSourceConfig): HeadersInit {
	return {
		'user-agent': source.userAgent ?? process.env.NEWS_DECK_USER_AGENT ?? 'next-news-deck/0.1 (+https://example.local)',
		'accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
	};
}

function buildArticleHeaders(source: FeedSourceConfig): HeadersInit {
	return {
		'user-agent': source.userAgent ?? process.env.NEWS_DECK_USER_AGENT ?? 'next-news-deck/0.1 (+https://example.local)',
		'accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
	};
}

function getNumberFromEnv(value: string | undefined, fallback: number) {
	if (!value) {
		return fallback;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, handler: (item: T) => Promise<R>) {
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const workerCount = Math.min(Math.max(concurrency, 1), items.length || 1);

	const workers = Array.from({ length: workerCount }, async () => {
		while (nextIndex < items.length) {
			const currentIndex = nextIndex++;
			results[currentIndex] = await handler(items[currentIndex]);
		}
	});

	await Promise.all(workers);
	return results;
}

async function enrichRssItemsWithContent(items: FeedItem[], source: FeedSourceConfig) {
	const minContentChars = getNumberFromEnv(process.env.NEWS_DECK_RSS_MIN_CONTENT_CHARS, DEFAULT_MIN_CONTENT_CHARS);
	const timeoutMs = getNumberFromEnv(process.env.NEWS_DECK_RSS_ARTICLE_TIMEOUT_MS, DEFAULT_ARTICLE_TIMEOUT_MS);
	const concurrency = getNumberFromEnv(process.env.NEWS_DECK_RSS_ARTICLE_CONCURRENCY, DEFAULT_CONCURRENCY);
	const headers = buildArticleHeaders(source);

	const enriched = await mapWithConcurrency(items, concurrency, async (item) => {
		// Respect per-domain rate limiting
		await RATE_LIMITER.waitForSlot(item.url);

		try {
			const result = await fetchArticleText(item.url, headers, timeoutMs);
			const { text: articleText, metadata } = result;
			const content = articleText || item.content || '';
			const summary = content ? truncate(content, 220) : item.summary;

			return {
				...item,
				content,
				summary,
				author: metadata.author || item.author,
				imageUrl: metadata.imageUrl || item.imageUrl,
				// Store lightweight metadata without bloating the item
			};
		} finally {
			RATE_LIMITER.release(item.url);
		}
	});

	return enriched.filter((item) => (item.content?.length ?? 0) >= minContentChars);
}

export async function fetchRssSource(source: FeedSourceConfig): Promise<FeedSourceResult> {
	const response = await fetch(source.feedUrl, {
		headers: buildHeaders(source),
		next: { revalidate: 0 },
	});

	if (!response.ok) {
		throw new Error(`Unable to fetch ${source.title} (${response.status})`);
	}

	const xml = await response.text();
	const feed = await parser.parseString(xml);
	const fetchedAt = new Date().toISOString();
	const staleAt = new Date(Date.now() + source.pollMinutes * 60_000).toISOString();
	const items = (feed.items ?? [])
		.map((item) => normalizeFeedItem(item, source))
		.filter((item): item is NonNullable<typeof item> => Boolean(item))
		.slice(0, source.maxItems);
	const enrichedItems = await enrichRssItemsWithContent(items, source);

	return {
		source,
		items: enrichedItems,
		fetchedAt,
		staleAt,
	};
}
