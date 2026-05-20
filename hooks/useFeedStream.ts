'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { FeedResponse } from '@/lib/feeds/types';

const DEFAULT_REFRESH_MS = 90_000;

export function useFeedStream(refreshMs = DEFAULT_REFRESH_MS) {
	const [data, setData] = useState<FeedResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const mountedRef = useRef(true);

	const refresh = useCallback(async () => {
		try {
			setIsRefreshing(true);
			setError(null);

			const response = await fetch('/api/feeds', {
				cache: 'no-store',
			});

			if (!response.ok) {
				throw new Error(`Feed request failed (${response.status})`);
			}

			const payload = (await response.json()) as FeedResponse;

			if (!mountedRef.current) {
				return;
			}

			setData(payload);
		} catch (nextError) {
			if (!mountedRef.current) {
				return;
			}

			setError(nextError instanceof Error ? nextError.message : 'Unable to refresh feeds right now.');
		} finally {
			if (!mountedRef.current) {
				return;
			}

			setIsLoading(false);
			setIsRefreshing(false);
		}
	}, []);

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
	}, [refresh, refreshMs]);

	return {
		data,
		error,
		isLoading,
		isRefreshing,
		refresh,
	};
}
