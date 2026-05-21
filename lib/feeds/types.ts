export type FeedSourceKind = 'rss' | 'reddit' | 'web-crawl';
export type FeedVelocity = 'fast' | 'slow';
export type CacheMode = 'memory' | 'redis';
export type FeedSourceCrawlEngine = 'cheerio' | 'scrapy';

export interface FeedResourceLink {
	title: string;
	url: string;
	sourceLabel?: string;
}

export interface FeedItem {
	id: string;
	dedupeKey: string;
	title: string;
	url: string;
	summary: string;
	content?: string;
	sourceId: string;
	sourceName: string;
	sourceKind: FeedSourceKind;
	publishedAt: string;
	author?: string;
	imageUrl?: string;
	videoUrl?: string;
	videoEmbedUrl?: string;
	tags: string[];
	originFeedUrl: string;
	discoverySource?: 'bing' | 'google';
	additionalImageUrls?: string[];
	resourceLinks?: FeedResourceLink[];
}

export interface FeedSourceConfig {
	id: string;
	kind: FeedSourceKind;
	title: string;
	description: string;
	siteUrl: string;
	feedUrl: string;
	pollMinutes: number;
	maxItems: number;
	tags: string[];
	userAgent?: string;
	query?: string;
	seedUrls?: string[];
	crawlDepth?: number;
	crawlMaxPages?: number;
	sameDomainOnly?: boolean;
	crawlEngine?: FeedSourceCrawlEngine;
}

export interface FeedSourceWithMeta extends FeedSourceConfig {
	builtIn: boolean;
	attachedColumnIds: string[];
}

export interface FeedSourceRegistryDocument {
	version: 1;
	upserts: FeedSourceConfig[];
	deletedIds: string[];
}

export interface FeedColumnConfig {
	id: string;
	title: string;
	description: string;
	velocity: FeedVelocity;
	sourceIds: string[];
	tagLabel?: string;
	filterTags?: string[];
	maxItems: number;
	accentFrom: string;
	accentTo: string;
}

export interface FeedSourceError {
	sourceId: string;
	message: string;
	retryable: boolean;
}

export interface FeedSourceStatus {
	sourceId: string;
	title: string;
	cached: boolean;
	itemCount: number;
	fetchedAt: string;
	staleAt: string;
	error?: string;
}

export interface FeedSourceResult {
	source: FeedSourceConfig;
	items: FeedItem[];
	fetchedAt: string;
	staleAt: string;
	error?: FeedSourceError;
}

export interface FeedSourceData extends FeedSourceConfig {
	items: FeedItem[];
	fetchedAt: string;
	staleAt: string;
	cached: boolean;
	error?: string;
}

export interface FeedColumnData extends FeedColumnConfig {
	items: FeedItem[];
	fetchedAt: string;
	staleAt: string;
	cached: boolean;
	sourceStatuses: FeedSourceStatus[];
}

export interface FeedResponse {
	generatedAt: string;
	cacheMode: CacheMode;
	sources: FeedSourceData[];
	columns: FeedColumnData[];
}

export interface FeedLiveUpdate {
	eventId: string;
	emittedAt: string;
	sourceId: string;
	sourceTitle: string;
	sourceKind: FeedSourceKind;
	columnIds: string[];
	fetchedAt: string;
	staleAt: string;
	totalItems: number;
	newItems: FeedItem[];
}

export interface FeedSourceTestResult {
	sourceId: string;
	sourceTitle: string;
	kind: FeedSourceKind;
	ok: boolean;
	testedAt: string;
	durationMs: number;
	itemCount: number;
	fetchedAt?: string;
	staleAt?: string;
	error?: string;
	sampleTitles: string[];
	sampleUrls: string[];
}
