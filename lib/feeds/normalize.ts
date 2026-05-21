import { createHash } from 'node:crypto';

import { FeedItem, FeedSourceConfig } from '@/lib/feeds/types';

export interface ParsedFeedItem {
	'title'?: string;
	'link'?: string;
	'guid'?: string;
	'isoDate'?: string;
	'pubDate'?: string;
	'creator'?: string;
	'author'?: string;
	'contentSnippet'?: string;
	'content'?: string;
	'contentEncoded'?: string;
	'categories'?: string[];
	'enclosure'?: {
		url?: string;
		type?: string;
	};
	'content:encoded'?: string;
	'itunes:image'?: {
		href?: string;
	};
	'media:content'?: Array<
		| {
				url?: string;
				medium?: string;
				$type?: string;
		  }
		| {
				$: {
					url?: string;
					medium?: string;
					type?: string;
				};
		  }
	>;
	'media:thumbnail'?: Array<
		| {
				url?: string;
		  }
		| {
				$: {
					url?: string;
				};
		  }
	>;
}

const HTML_TAG_PATTERN = /<[^>]+>/g;
const WHITESPACE_PATTERN = /\s+/g;
const HTML_IMAGE_SRC_PATTERN = /<img[^>]+(?:src|data-src)=['"]([^'"]+)['"][^>]*>/i;
const BLOCKED_IMAGE_KEYWORDS = /(logo|icon|favicon|avatar|sprite|badge|watermark|masthead|brandmark|branding|pixel|tracking|spacer|ads?|advert|promo|newsletter)/i;
const BLOCKED_IMAGE_HOSTS = /(doubleclick\.net|googleadservices\.com|googlesyndication\.com|adservice|ads\.)/i;
const NON_ARTICLE_IMAGE_EXTENSIONS = /\.(?:svg|gif)(?:$|[?#])/i;

function toAbsoluteUrl(candidate: string, baseUrl?: string) {
	try {
		return new URL(candidate, baseUrl).toString();
	} catch {
		return '';
	}
}

function looksLikeBlockedImage(url: string) {
	try {
		const parsed = new URL(url);
		const combined = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();

		if (BLOCKED_IMAGE_HOSTS.test(parsed.hostname)) {
			return true;
		}

		if (NON_ARTICLE_IMAGE_EXTENSIONS.test(parsed.pathname)) {
			return true;
		}

		if (BLOCKED_IMAGE_KEYWORDS.test(combined)) {
			return true;
		}

		if (/(^|[?&_/-])(w|width|h|height)=?(?:1|16|24|32|48|64)($|[?&_/-])/i.test(combined)) {
			return true;
		}

		return false;
	} catch {
		return true;
	}
}

export function sanitizeArticleImageUrl(candidate?: string, baseUrl?: string) {
	if (!candidate) {
		return undefined;
	}

	const resolved = toAbsoluteUrl(candidate.trim(), baseUrl);
	if (!resolved) {
		return undefined;
	}

	return looksLikeBlockedImage(resolved) ? undefined : resolved;
}

function extractImageFromHtml(html?: string, baseUrl?: string) {
	if (!html) {
		return undefined;
	}

	const match = html.match(HTML_IMAGE_SRC_PATTERN);
	return sanitizeArticleImageUrl(match?.[1], baseUrl);
}

function extractMediaImageUrl(item: ParsedFeedItem, baseUrl?: string) {
	const mediaContent = item['media:content'] ?? [];
	for (const entry of mediaContent) {
		const candidate = '$' in entry ? entry.$.url : entry.url;
		const medium = '$' in entry ? entry.$.medium : entry.medium;
		const type = '$' in entry ? entry.$.type : entry.$type;
		if (medium && medium !== 'image') {
			continue;
		}
		if (type && !type.startsWith('image/')) {
			continue;
		}

		const sanitized = sanitizeArticleImageUrl(candidate, baseUrl);
		if (sanitized) {
			return sanitized;
		}
	}

	const mediaThumbnails = item['media:thumbnail'] ?? [];
	for (const entry of mediaThumbnails) {
		const candidate = '$' in entry ? entry.$.url : entry.url;
		const sanitized = sanitizeArticleImageUrl(candidate, baseUrl);
		if (sanitized) {
			return sanitized;
		}
	}

	const itunesImage = sanitizeArticleImageUrl(item['itunes:image']?.href, baseUrl);
	if (itunesImage) {
		return itunesImage;
	}

	return undefined;
}

function extractFeedImageUrl(item: ParsedFeedItem, source: FeedSourceConfig, articleUrl: string) {
	const baseUrl = articleUrl || source.siteUrl || source.feedUrl;

	const enclosureImage = item.enclosure?.type?.startsWith('image/') || !item.enclosure?.type ? sanitizeArticleImageUrl(item.enclosure?.url, baseUrl) : undefined;
	if (enclosureImage) {
		return enclosureImage;
	}

	const mediaImage = extractMediaImageUrl(item, baseUrl);
	if (mediaImage) {
		return mediaImage;
	}

	const encodedImage = extractImageFromHtml(item['content:encoded'] ?? item.contentEncoded, baseUrl);
	if (encodedImage) {
		return encodedImage;
	}

	return extractImageFromHtml(item.content, baseUrl);
}

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

	const rawContent = item['content:encoded'] ?? item.contentEncoded ?? item.content ?? '';
	const content = stripHtml(rawContent);
	const summary = truncate(stripHtml(item.contentSnippet ?? rawContent), 220);
	const publishedAt = toIsoDate(item.isoDate ?? item.pubDate);
	const dedupeKey = buildDedupeKey(title, url);
	const imageUrl = extractFeedImageUrl(item, source, url);

	return {
		id: item.guid?.trim() || dedupeKey,
		dedupeKey,
		title,
		url,
		summary,
		content,
		sourceId: source.id,
		sourceName: source.title,
		sourceKind: source.kind,
		publishedAt,
		author: stripHtml(item.creator ?? item.author),
		imageUrl,
		tags: [...new Set([...(item.categories ?? []), ...source.tags].map(stripHtml).filter(Boolean))],
		originFeedUrl: source.feedUrl,
	};
}

function feedItemRichnessScore(item: FeedItem) {
	return (
		(item.content?.length ?? 0) +
		Math.round((item.summary?.length ?? 0) / 2) +
		(item.imageUrl ? 500 : 0) +
		(item.videoEmbedUrl ? 750 : 0) +
		(item.videoUrl ? 600 : 0) +
		(item.author ? 50 : 0)
	);
}

export function dedupeAndSortFeedItems(items: FeedItem[]): FeedItem[] {
	const deduped = new Map<string, FeedItem>();

	for (const item of items) {
		const existing = deduped.get(item.dedupeKey);

		if (!existing) {
			deduped.set(item.dedupeKey, item);
			continue;
		}

		const preferIncoming = feedItemRichnessScore(item) > feedItemRichnessScore(existing);
		const preferred = preferIncoming ? item : existing;
		const fallback = preferIncoming ? existing : item;

		deduped.set(item.dedupeKey, {
			...fallback,
			...preferred,
			summary: preferred.summary.length >= fallback.summary.length ? preferred.summary : fallback.summary,
			content: (preferred.content?.length ?? 0) >= (fallback.content?.length ?? 0) ? preferred.content : fallback.content,
			imageUrl: preferred.imageUrl ?? fallback.imageUrl,
			videoUrl: preferred.videoUrl ?? fallback.videoUrl,
			videoEmbedUrl: preferred.videoEmbedUrl ?? fallback.videoEmbedUrl,
			author: preferred.author ?? fallback.author,
			discoverySource: preferred.discoverySource ?? fallback.discoverySource,
			tags: [...new Set([...(fallback.tags ?? []), ...(preferred.tags ?? [])])],
		});
	}

	return [...deduped.values()].sort((left, right) => {
		return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
	});
}
