'use client';

import { DragEndEvent, DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import Link from 'next/link';
import { useMemo, useSyncExternalStore } from 'react';

import { ColumnComposer } from '@/components/dashboard/ColumnComposer';
import { FeedColumn } from '@/components/dashboard/FeedColumn';
import { SortableColumn } from '@/components/dashboard/SortableColumn';
import { defaultFeedColumns, defaultFeedSources } from '@/lib/config/default-columns';
import { useColumnState } from '@/hooks/useColumnState';
import { useFeedStream } from '@/hooks/useFeedStream';
import { buildColumnData, buildSourceDataMap } from '@/lib/feeds/compose';
import { FeedSourceData } from '@/lib/feeds/types';

function subscribeToHydration() {
	return () => undefined;
}

function useHydrated() {
	return useSyncExternalStore(
		subscribeToHydration,
		() => true,
		() => false,
	);
}

function formatRelativeTime(isoDate: string | null) {
	if (!isoDate) {
		return 'Awaiting first refresh';
	}

	const date = new Date(isoDate);
	const diffMs = Date.now() - date.getTime();
	const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));

	if (diffMinutes < 1) {
		return 'Updated just now';
	}

	if (diffMinutes === 1) {
		return 'Updated 1 minute ago';
	}

	if (diffMinutes < 60) {
		return `Updated ${diffMinutes} minutes ago`;
	}

	const diffHours = Math.round(diffMinutes / 60);
	return `Updated ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
}

function buildPlaceholderSources(): FeedSourceData[] {
	const now = new Date().toISOString();

	return defaultFeedSources.map((source) => ({
		...source,
		items: [],
		fetchedAt: now,
		staleAt: now,
		cached: false,
	}));
}

function mergeSourceData(sources?: FeedSourceData[]) {
	const placeholderSources = buildPlaceholderSources();
	if (!sources || sources.length === 0) {
		return placeholderSources;
	}

	const sourceMap = new Map(placeholderSources.map((source) => [source.id, source]));
	for (const source of sources) {
		sourceMap.set(source.id, source);
	}

	return [...sourceMap.values()];
}

export function NewsDeck() {
	const { orderedColumns, visibleColumnIds, readItemIds, toggleColumn, addCustomColumn, removeCustomColumn, reorderColumns, markItemRead, toggleItemRead } =
		useColumnState(defaultFeedColumns);
	const prioritizedColumnIds = useMemo(
		() => orderedColumns.filter((column) => visibleColumnIds.includes(column.id)).map((column) => column.id),
		[orderedColumns, visibleColumnIds],
	);
	const { data, error, isLiveConnected, isLoading, isRefreshing, loadingColumnIds, refresh } = useFeedStream(prioritizedColumnIds);
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
	const isHydrated = useHydrated();
	const sourceData = useMemo(() => mergeSourceData(data?.sources), [data]);

	const allColumns = useMemo(() => {
		const sourceMap = buildSourceDataMap(sourceData);
		return orderedColumns.map((column) => buildColumnData(column, sourceMap));
	}, [orderedColumns, sourceData]);

	const visibleColumns = useMemo(() => {
		return allColumns.filter((column) => visibleColumnIds.includes(column.id));
	}, [allColumns, visibleColumnIds]);

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;

		if (!over || active.id === over.id) {
			return;
		}

		reorderColumns(String(active.id), String(over.id));
	}

	return (
		<div className='h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.24),transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_48%,#020617_100%)] text-slate-50'>
			<main className='mx-auto flex h-screen max-w-450 flex-col overflow-hidden px-3 py-3 sm:px-4 lg:px-5'>
				<header className='shrink-0 rounded-3xl border border-white/10 bg-slate-950/55 px-3 py-3 shadow-2xl backdrop-blur-sm'>
					<div className='flex flex-wrap items-center gap-2 text-[11px] text-slate-300'>
						<span className='rounded-full border border-white/10 bg-white/5 px-2 py-1 font-medium text-cyan-100'>{formatRelativeTime(data?.generatedAt ?? null)}</span>
						<span className='rounded-full border border-white/10 bg-white/5 px-2 py-1'>
							cache <span className='font-semibold text-cyan-200'>{data?.cacheMode ?? 'memory'}</span>
						</span>
						<span
							className={`rounded-full border px-2 py-1 font-medium ${
								isLiveConnected ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100' : 'border-amber-400/30 bg-amber-500/10 text-amber-100'
							}`}>
							{isLiveConnected ? 'live updates on' : 'live reconnecting'}
						</span>
						<button
							type='button'
							onClick={() => void refresh()}
							className='rounded-full bg-cyan-400 px-2.5 py-1 font-medium text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-950 disabled:text-cyan-200'
							disabled={isRefreshing}>
							{isRefreshing ? 'Refreshing…' : 'Refresh'}
						</button>
						<Link
							href='/sse-status'
							className='rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-medium text-slate-100 transition hover:border-cyan-300/30 hover:text-white'>
							SSE status
						</Link>
					</div>

					<ColumnComposer
						availableSources={sourceData}
						columns={orderedColumns}
						visibleColumnIds={visibleColumnIds}
						onToggleColumn={toggleColumn}
						onAddCustomColumn={addCustomColumn}
						onRemoveCustomColumn={removeCustomColumn}
					/>

					{error ?
						<p className='mt-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100'>{error}</p>
					:	null}
				</header>

				{isHydrated ?
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragEnd={handleDragEnd}>
						<SortableContext
							items={visibleColumns.map((column) => column.id)}
							strategy={horizontalListSortingStrategy}>
							<section className='mt-3 flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden pb-0'>
								{visibleColumns.map((column) => (
									<SortableColumn
										key={column.id}
										column={column}
										isLoading={isLoading || loadingColumnIds.includes(column.id)}
										readItemIds={readItemIds}
										onOpenItem={markItemRead}
										onToggleRead={toggleItemRead}
										onRemoveCustomColumn={removeCustomColumn}
									/>
								))}
							</section>
						</SortableContext>
					</DndContext>
				:	<section className='mt-3 flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden pb-0'>
						{visibleColumns.map((column) => {
							const isCustom = column.id.startsWith('custom-');

							return (
								<div
									key={column.id}
									className='flex h-full min-h-0 min-w-[20rem] flex-1'>
									<FeedColumn
										column={column}
										isLoading={isLoading || loadingColumnIds.includes(column.id)}
										readItemIds={readItemIds}
										onOpenItem={markItemRead}
										onToggleRead={toggleItemRead}
										headerActions={
											isCustom ?
												<button
													type='button'
													onClick={() => removeCustomColumn(column.id)}
													className='rounded-full border border-rose-300/20 px-3 py-1 text-xs font-medium text-rose-100 transition hover:border-rose-300/40 hover:text-white'>
													Remove
												</button>
											:	undefined
										}
									/>
								</div>
							);
						})}
					</section>
				}
			</main>
		</div>
	);
}
