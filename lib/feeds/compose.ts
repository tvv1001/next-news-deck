import { dedupeAndSortFeedItems } from '@/lib/feeds/normalize';
import { FeedColumnConfig, FeedColumnData, FeedSourceData } from '@/lib/feeds/types';

export function buildSourceDataMap(sources: FeedSourceData[]) {
	return new Map(sources.map((source) => [source.id, source]));
}

export function buildColumnData(column: FeedColumnConfig, sourceMap: Map<string, FeedSourceData>): FeedColumnData {
	const linkedSources = column.sourceIds.map((sourceId) => sourceMap.get(sourceId)).filter((source): source is FeedSourceData => Boolean(source));
	const items = dedupeAndSortFeedItems(linkedSources.flatMap((source) => source.items)).slice(0, column.maxItems);
	const sourceStatuses = linkedSources.map((source) => ({
		sourceId: source.id,
		title: source.title,
		cached: source.cached,
		itemCount: source.items.length,
		fetchedAt: source.fetchedAt,
		staleAt: source.staleAt,
		error: source.error,
	}));
	const now = new Date().toISOString();
	const fetchedAt = sourceStatuses.reduce((latest, current) => {
		return latest > current.fetchedAt ? latest : current.fetchedAt;
	}, sourceStatuses[0]?.fetchedAt ?? now);
	const staleAt = sourceStatuses.reduce((earliest, current) => {
		return earliest < current.staleAt ? earliest : current.staleAt;
	}, sourceStatuses[0]?.staleAt ?? now);

	return {
		...column,
		items,
		fetchedAt,
		staleAt,
		cached: linkedSources.length > 0 && linkedSources.every((source) => source.cached),
		sourceStatuses,
	};
}
