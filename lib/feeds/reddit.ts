import { fetchRssSource } from '@/lib/feeds/rss';
import { FeedSourceConfig, FeedSourceResult } from '@/lib/feeds/types';

export async function fetchRedditSource(source: FeedSourceConfig): Promise<FeedSourceResult> {
	if (source.kind !== 'reddit') {
		throw new Error(`Source ${source.id} is not a Reddit feed.`);
	}

	return fetchRssSource({
		...source,
		userAgent: source.userAgent ?? process.env.NEWS_DECK_USER_AGENT ?? 'next-news-deck/0.1 (contact: local-dev)',
	});
}
