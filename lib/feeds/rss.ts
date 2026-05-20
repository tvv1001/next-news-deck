import Parser from 'rss-parser';

import { normalizeFeedItem, type ParsedFeedItem } from '@/lib/feeds/normalize';
import { FeedSourceConfig, FeedSourceResult } from '@/lib/feeds/types';

const parser = new Parser<Record<string, never>, ParsedFeedItem>();

function buildHeaders(source: FeedSourceConfig): HeadersInit {
	return {
		'user-agent': source.userAgent ?? process.env.NEWS_DECK_USER_AGENT ?? 'next-news-deck/0.1 (+https://example.local)',
		'accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
	};
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

	return {
		source,
		items: (feed.items ?? [])
			.map((item) => normalizeFeedItem(item, source))
			.filter((item): item is NonNullable<typeof item> => Boolean(item))
			.slice(0, source.maxItems),
		fetchedAt,
		staleAt,
	};
}
