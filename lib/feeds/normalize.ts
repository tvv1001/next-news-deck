import { createHash } from 'node:crypto';

import { FeedItem, FeedSourceConfig } from '@/lib/feeds/types';

export interface ParsedFeedItem {
	title?: string;
	link?: string;
	guid?: string;
	isoDate?: string;
	pubDate?: string;
	creator?: string;
	author?: string;
	contentSnippet?: string;
	content?: string;
	contentEncoded?: string;
	categories?: string[];
	enclosure?: {
		url?: string;
	};
}

const HTML_TAG_PATTERN = /<[^>]+>/g;
const WHITESPACE_PATTERN = /\s+/g;

export function stripHtml(input?: string): string {
	if (!input) {
		return '';
	}

	return input
		.replace(HTML_TAG_PATTERN, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(WHITESPACE_PATTERN, ' ')
		.trim();
}

export function truncate(input: string, maxLength: number): string {
	if (input.length <= maxLength) {
		return input;
	}

	return `${input.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function toIsoDate(value?: string): string {
	const parsed = value ? new Date(value) : new Date();
	return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function buildDedupeKey(title: string, url: string): string {
	return createHash('sha1').update(`${title.toLowerCase()}::${url.toLowerCase()}`).digest('hex');
}

export function normalizeFeedItem(item: ParsedFeedItem, source: FeedSourceConfig): FeedItem | null {
	const title = stripHtml(item.title);
	const url = item.link?.trim();

	if (!title || !url) {
		return null;
	}

	const summary = truncate(stripHtml(item.contentSnippet ?? item.contentEncoded ?? item.content), 220);
	const publishedAt = toIsoDate(item.isoDate ?? item.pubDate);
	const dedupeKey = buildDedupeKey(title, url);

	return {
		id: item.guid?.trim() || dedupeKey,
		dedupeKey,
		title,
		url,
		summary,
		sourceId: source.id,
		sourceName: source.title,
		sourceKind: source.kind,
		publishedAt,
		author: stripHtml(item.creator ?? item.author),
		imageUrl: item.enclosure?.url,
		tags: [...new Set([...(item.categories ?? []), ...source.tags].map(stripHtml).filter(Boolean))],
		originFeedUrl: source.feedUrl,
	};
}

export function dedupeAndSortFeedItems(items: FeedItem[]): FeedItem[] {
	const deduped = new Map<string, FeedItem>();

	for (const item of items) {
		if (!deduped.has(item.dedupeKey)) {
			deduped.set(item.dedupeKey, item);
		}
	}

	return [...deduped.values()].sort((left, right) => {
		return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
	});
}
