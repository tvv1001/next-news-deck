'use client';

import { useEffect, useMemo, useState } from 'react';

import { FeedColumnConfig } from '@/lib/feeds/types';

const STORAGE_KEY = 'next-news-deck-ui-state:v1';

interface PersistedColumnState {
	visibleColumnIds?: string[];
	orderedColumnIds: string[];
	hiddenColumnIds: string[];
	customColumns: FeedColumnConfig[];
	readItemIds: string[];
}

function isFeedColumnConfig(value: unknown): value is FeedColumnConfig {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<FeedColumnConfig>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.title === 'string' &&
		typeof candidate.description === 'string' &&
		(candidate.velocity === 'fast' || candidate.velocity === 'slow') &&
		Array.isArray(candidate.sourceIds) &&
		typeof candidate.maxItems === 'number' &&
		typeof candidate.accentFrom === 'string' &&
		typeof candidate.accentTo === 'string'
	);
}

function normalizeOrderedIds(allColumnIds: string[], orderedIds: string[]) {
	const orderedSet = new Set(orderedIds.filter((id) => allColumnIds.includes(id)));
	return [...orderedSet, ...allColumnIds.filter((id) => !orderedSet.has(id))];
}

export function useColumnState(defaultColumns: FeedColumnConfig[]) {
	const defaultColumnIds = useMemo(() => defaultColumns.map((column) => column.id), [defaultColumns]);
	const [customColumns, setCustomColumns] = useState<FeedColumnConfig[]>([]);
	const [orderedColumnIds, setOrderedColumnIds] = useState(defaultColumnIds);
	const [hiddenColumnIds, setHiddenColumnIds] = useState<string[]>([]);
	const [readItemIds, setReadItemIds] = useState<string[]>([]);
	const [hasHydrated, setHasHydrated] = useState(false);
	const allColumns = useMemo(() => [...defaultColumns, ...customColumns], [customColumns, defaultColumns]);
	const allColumnIds = useMemo(() => allColumns.map((column) => column.id), [allColumns]);

	useEffect(() => {
		let cancelled = false;

		try {
			const rawValue = window.localStorage.getItem(STORAGE_KEY);

			if (!rawValue) {
				queueMicrotask(() => {
					if (!cancelled) {
						setHasHydrated(true);
					}
				});
				return;
			}

			const parsed = JSON.parse(rawValue) as Partial<PersistedColumnState>;
			const nextCustomColumns = parsed.customColumns?.filter(isFeedColumnConfig) ?? [];
			const nextAllColumnIds = [...defaultColumnIds, ...nextCustomColumns.map((column) => column.id)];
			const nextVisibleIds = parsed.visibleColumnIds?.filter((id) => nextAllColumnIds.includes(id));
			const nextOrderedIds = normalizeOrderedIds(nextAllColumnIds, parsed.orderedColumnIds ?? nextVisibleIds ?? defaultColumnIds);
			const nextHiddenIds = (parsed.hiddenColumnIds ?? nextAllColumnIds.filter((id) => !(nextVisibleIds ?? defaultColumnIds).includes(id))).filter((id) =>
				nextAllColumnIds.includes(id),
			);
			const nextReadIds = parsed.readItemIds?.filter(Boolean) ?? [];

			queueMicrotask(() => {
				if (cancelled) {
					return;
				}

				setCustomColumns(nextCustomColumns);
				setOrderedColumnIds(nextOrderedIds);
				setHiddenColumnIds(nextHiddenIds);
				setReadItemIds(nextReadIds);
				setHasHydrated(true);
			});
		} catch (error) {
			console.error('Unable to restore saved dashboard state.', error);
			queueMicrotask(() => {
				if (!cancelled) {
					setHasHydrated(true);
				}
			});
		}

		return () => {
			cancelled = true;
		};
	}, [defaultColumnIds]);

	useEffect(() => {
		if (!hasHydrated) {
			return;
		}

		const payload: PersistedColumnState = {
			orderedColumnIds: normalizeOrderedIds(allColumnIds, orderedColumnIds),
			hiddenColumnIds: hiddenColumnIds.filter((id) => allColumnIds.includes(id)),
			customColumns,
			readItemIds,
			visibleColumnIds: normalizeOrderedIds(allColumnIds, orderedColumnIds).filter((id) => !hiddenColumnIds.includes(id)),
		};

		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	}, [allColumnIds, customColumns, hasHydrated, hiddenColumnIds, orderedColumnIds, readItemIds]);

	const orderedColumns = useMemo(() => {
		const columnMap = new Map(allColumns.map((column) => [column.id, column]));
		return normalizeOrderedIds(allColumnIds, orderedColumnIds)
			.map((columnId) => columnMap.get(columnId))
			.filter((column): column is FeedColumnConfig => Boolean(column));
	}, [allColumnIds, allColumns, orderedColumnIds]);
	const visibleColumnIds = useMemo(() => orderedColumns.map((column) => column.id).filter((columnId) => !hiddenColumnIds.includes(columnId)), [hiddenColumnIds, orderedColumns]);
	const readIdSet = useMemo(() => new Set(readItemIds), [readItemIds]);

	function toggleColumn(columnId: string) {
		setHiddenColumnIds((current) => {
			if (current.includes(columnId)) {
				return current.filter((id) => id !== columnId);
			}

			const visibleCount = allColumnIds.filter((id) => !current.includes(id)).length;

			if (visibleCount <= 1) {
				return current;
			}

			return [...current, columnId];
		});
	}

	function addCustomColumn(column: FeedColumnConfig) {
		setCustomColumns((current) => [...current, column]);
		setOrderedColumnIds((current) => [...current, column.id]);
		setHiddenColumnIds((current) => current.filter((id) => id !== column.id));
	}

	function removeCustomColumn(columnId: string) {
		setCustomColumns((current) => current.filter((column) => column.id !== columnId));
		setOrderedColumnIds((current) => current.filter((id) => id !== columnId));
		setHiddenColumnIds((current) => current.filter((id) => id !== columnId));
	}

	function reorderColumns(activeId: string, overId: string) {
		if (activeId === overId) {
			return;
		}

		setOrderedColumnIds((current) => {
			const normalized = normalizeOrderedIds(allColumnIds, current);
			const activeIndex = normalized.indexOf(activeId);
			const overIndex = normalized.indexOf(overId);

			if (activeIndex === -1 || overIndex === -1) {
				return current;
			}

			const nextOrder = [...normalized];
			const [moved] = nextOrder.splice(activeIndex, 1);
			nextOrder.splice(overIndex, 0, moved);

			return nextOrder;
		});
	}

	function markItemRead(itemId: string) {
		setReadItemIds((current) => {
			return current.includes(itemId) ? current : [...current, itemId];
		});
	}

	function toggleItemRead(itemId: string) {
		setReadItemIds((current) => {
			return current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId];
		});
	}

	return {
		hasHydrated,
		orderedColumns,
		customColumns,
		visibleColumnIds,
		readItemIds: readIdSet,
		toggleColumn,
		addCustomColumn,
		removeCustomColumn,
		reorderColumns,
		markItemRead,
		toggleItemRead,
	};
}
