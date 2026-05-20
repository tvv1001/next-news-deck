export type FeedSourceKind = 'rss' | 'reddit';
export type FeedVelocity = 'fast' | 'slow';
export type CacheMode = 'memory' | 'redis';

export interface FeedItem {
	id: string;
	dedupeKey: string;
	title: string;
	url: string;
	summary: string;
	sourceId: string;
	sourceName: string;
	sourceKind: FeedSourceKind;
	publishedAt: string;
	author?: string;
	imageUrl?: string;
	tags: string[];
	originFeedUrl: string;
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
}

export interface FeedColumnConfig {
	id: string;
	title: string;
	description: string;
	velocity: FeedVelocity;
	sourceIds: string[];
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
