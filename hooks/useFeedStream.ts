'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { defaultFeedColumns } from '@/lib/config/default-columns';
import { FeedResponse } from '@/lib/feeds/types';

const DEFAULT_REFRESH_MS = 30_000;

function mergeFeedResponse(previous: FeedResponse | null, next: FeedResponse): FeedResponse {
	if (!previous) {
		return next;
	}

	const sourceMap = new Map(previous.sources.map((source) => [source.id, source]));
	for (const source of next.sources) {
		sourceMap.set(source.id, source);
	}

	const columnMap = new Map(previous.columns.map((column) => [column.id, column]));
	for (const column of next.columns) {
		columnMap.set(column.id, column);
	}

	return {
		generatedAt: next.generatedAt,
		cacheMode: next.cacheMode,
		sources: [...sourceMap.values()],
		columns: [...columnMap.values()],
	};
}

export function useFeedStream(priorityColumnIds: string[], refreshMs = DEFAULT_REFRESH_MS) {
	const [data, setData] = useState<FeedResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [loadingColumnIds, setLoadingColumnIds] = useState<string[]>([]);
	const mountedRef = useRef(true);
	const refreshInFlightRef = useRef<Promise<void> | null>(null);
	const dataRef = useRef<FeedResponse | null>(null);
	const columnOrder = useMemo(() => (priorityColumnIds.length > 0 ? priorityColumnIds : defaultFeedColumns.map((column) => column.id)), [priorityColumnIds]);
	const columnOrderKey = columnOrder.join('|');

	useEffect(() => {
		dataRef.current = data;
	}, [data]);

	const refresh = useCallback(async () => {
		if (refreshInFlightRef.current) {
			return await refreshInFlightRef.current;
		}

		const refreshPromise = (async () => {
			try {
				setIsRefreshing(true);
				setError(null);
				setLoadingColumnIds(columnOrder);

				let mergedPayload = dataRef.current;

				for (const columnId of columnOrder) {
					try {
						const response = await fetch(`/api/feeds?columnId=${encodeURIComponent(columnId)}`, {
							cache: 'no-store',
						});

						if (!response.ok) {
							throw new Error(`Feed request failed (${response.status}) for ${columnId}`);
						}

						const payload = (await response.json()) as FeedResponse;

						if (!mountedRef.current) {
							return;
						}

						mergedPayload = mergeFeedResponse(mergedPayload, payload);
						dataRef.current = mergedPayload;
						setData(mergedPayload);
					} catch (columnError) {
						if (!mountedRef.current) {
							return;
						}

						setError(columnError instanceof Error ? columnError.message : 'Unable to refresh feeds right now.');
					} finally {
						if (mountedRef.current) {
							setLoadingColumnIds((current) => current.filter((currentId) => currentId !== columnId));
						}
					}
				}
			} catch (nextError) {
				if (!mountedRef.current) {
					return;
				}

				setError(nextError instanceof Error ? nextError.message : 'Unable to refresh feeds right now.');
			} finally {
				refreshInFlightRef.current = null;

				if (!mountedRef.current) {
					return;
				}

				setIsLoading(false);
				setIsRefreshing(false);
				setLoadingColumnIds([]);
			}
		})();

		refreshInFlightRef.current = refreshPromise;
		return await refreshPromise;
	}, [columnOrder]);

	useEffect(() => {
		mountedRef.current = true;
		const timeoutId = window.setTimeout(() => {
			void refresh();
		}, 0);

		const intervalId = window.setInterval(() => {
			void refresh();
		}, refreshMs);

		return () => {
			mountedRef.current = false;
			window.clearTimeout(timeoutId);
			window.clearInterval(intervalId);
		};
	}, [columnOrderKey, refresh, refreshMs]);

	return {
		data,
		error,
		isLoading,
		isRefreshing,
		loadingColumnIds,
		refresh,
	};
}
