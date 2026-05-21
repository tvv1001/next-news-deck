import { NextRequest, NextResponse } from 'next/server';

import { getPreferredCacheMode } from '@/lib/cache/redis';
import { defaultFeedColumns } from '@/lib/config/default-columns';
import { getConfiguredFeedSourceMap, getConfiguredFeedSources } from '@/lib/config/source-registry';
import { buildColumnData, buildSourceDataMap } from '@/lib/feeds/compose';
import { FeedColumnData, FeedResponse, FeedSourceConfig, FeedSourceData } from '@/lib/feeds/types';
import { getSourceResult } from '@/lib/feeds/source-runtime';

function selectColumns(columnId?: string | null) {
	if (!columnId) {
		return defaultFeedColumns;
	}

	return defaultFeedColumns.filter((column) => column.id === columnId);
}

function selectSources(columns: Array<{ sourceIds: string[] }>, allSources: FeedSourceConfig[]) {
	const sourceIds = new Set(columns.flatMap((column) => column.sourceIds));
	return allSources.filter((source) => sourceIds.has(source.id));
}

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);
	const columnId = searchParams.get('columnId');
	const columns = selectColumns(columnId);
	const configuredSources = await getConfiguredFeedSources();
	const configuredSourceMap = await getConfiguredFeedSourceMap();

	if (columnId && columns.length === 0) {
		return NextResponse.json({ error: `Unknown column \"${columnId}\".` }, { status: 404 });
	}

	const requestedSources = selectSources(columns, configuredSources);
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
		const linkedSources = column.sourceIds.map((sourceId) => configuredSourceMap.get(sourceId)).filter((source): source is FeedSourceConfig => Boolean(source));
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
	const configuredSources = await getConfiguredFeedSources();

	return NextResponse.json({
		cacheMode: getPreferredCacheMode(),
		columns: defaultFeedColumns.length,
		sources: configuredSources.length,
	});
}
