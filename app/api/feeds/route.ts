import { NextRequest, NextResponse } from 'next/server';

import { getCachedValue } from '@/lib/cache/feed-cache';
import { getPreferredCacheMode } from '@/lib/cache/redis';
import { buildColumnData, buildSourceDataMap } from '@/lib/feeds/compose';
import { defaultFeedColumns, defaultFeedSources, feedSourceMap } from '@/lib/config/default-columns';
import { fetchRedditSource } from '@/lib/feeds/reddit';
import { fetchRssSource } from '@/lib/feeds/rss';
import { publishFeedSourceUpdate } from '@/lib/feeds/live-updates';
import { fetchWebCrawlSource } from '@/lib/feeds/web-crawl';
import { FeedColumnData, FeedResponse, FeedSourceConfig, FeedSourceData, FeedSourceResult } from '@/lib/feeds/types';

async function fetchSourcePayload(source: FeedSourceConfig): Promise<FeedSourceResult> {
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

async function getSourceResult(source: FeedSourceConfig) {
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

function selectColumns(columnId?: string | null) {
	if (!columnId) {
		return defaultFeedColumns;
	}

	return defaultFeedColumns.filter((column) => column.id === columnId);
}

function selectSources(columns: Array<{ sourceIds: string[] }>) {
	const sourceIds = new Set(columns.flatMap((column) => column.sourceIds));
	return defaultFeedSources.filter((source) => sourceIds.has(source.id));
}

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);
	const columnId = searchParams.get('columnId');
	const columns = selectColumns(columnId);

	if (columnId && columns.length === 0) {
		return NextResponse.json({ error: `Unknown column \"${columnId}\".` }, { status: 404 });
	}

	const requestedSources = selectSources(columns);
	const sourceResults = await Promise.all(requestedSources.map(getSourceResult));
	const sources: FeedSourceData[] = sourceResults.map((result) => ({
		...result.value.source,
		items: result.value.items,
		fetchedAt: result.value.fetchedAt,
		staleAt: result.value.staleAt,
		cached: result.cached,
		error: result.value.error?.message,
	}));
	const sourceMap = buildSourceDataMap(sources);
	const hydratedColumns: FeedColumnData[] = columns.map((column) => {
		const linkedSources = column.sourceIds.map((sourceId) => feedSourceMap.get(sourceId)).filter((source): source is FeedSourceConfig => Boolean(source));
		const linkedSourceMap = buildSourceDataMap(linkedSources.map((source) => sourceMap.get(source.id)).filter((source): source is FeedSourceData => Boolean(source)));

		return buildColumnData(column, linkedSourceMap);
	});

	const response: FeedResponse = {
		generatedAt: new Date().toISOString(),
		cacheMode: getPreferredCacheMode(),
		sources,
		columns: hydratedColumns,
	};

	return NextResponse.json(response, {
		headers: {
			'cache-control': 'no-store, max-age=0',
		},
	});
}

export async function OPTIONS() {
	return NextResponse.json({
		cacheMode: getPreferredCacheMode(),
		columns: defaultFeedColumns.length,
		sources: defaultFeedSources.length,
	});
}
