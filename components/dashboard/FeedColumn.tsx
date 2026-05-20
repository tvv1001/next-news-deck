'use client';

import { ReactNode, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { FeedColumnData } from '@/lib/feeds/types';
import { FeedCard } from '@/components/dashboard/FeedCard';

interface FeedColumnProps {
	column: FeedColumnData;
	isLoading: boolean;
	readItemIds: Set<string>;
	onOpenItem: (itemId: string) => void;
	onToggleRead: (itemId: string) => void;
	headerActions?: ReactNode;
}

export function FeedColumn({ column, isLoading, readItemIds, onOpenItem, onToggleRead, headerActions }: FeedColumnProps) {
	const parentRef = useRef<HTMLDivElement>(null);
	// eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally used here for bounded DOM rendering.
	const virtualizer = useVirtualizer({
		count: column.items.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 244,
		overscan: 4,
		getItemKey: (index) => column.items[index]?.id ?? `${column.id}-${index}`,
	});

	return (
		<section className='flex h-full min-h-0 min-w-[20rem] flex-1 flex-col overflow-hidden rounded-4xl border border-white/10 bg-slate-950/60 shadow-2xl backdrop-blur-sm'>
			<div className={`border-b border-white/10 bg-linear-to-br ${column.accentFrom} ${column.accentTo} px-3 py-3`}>
				<div className='flex items-start justify-between gap-4'>
					<div>
						<p className='text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-100/90'>{column.velocity === 'fast' ? 'Fast lane' : 'Watch lane'}</p>
						<h2 className='mt-1 text-base font-semibold text-white'>{column.title}</h2>
						{column.tagLabel ?
							<p className='mt-2 inline-flex rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/90'>
								#{column.tagLabel}
							</p>
						:	null}
					</div>
					<div className='flex flex-col items-end gap-2'>
						{headerActions}
						<div className='text-right text-[10px] text-slate-200/85'>
							<p>{column.items.length} items</p>
							<p>{column.cached ? 'cache' : 'live'}</p>
						</div>
					</div>
				</div>

				<div className='mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-100/80'>
					{column.sourceStatuses.map((status) => (
						<span
							key={status.sourceId}
							className={`rounded-full border px-2 py-0.5 ${status.error ? 'border-rose-300/40 bg-rose-500/10 text-rose-100' : 'border-white/15 bg-white/10'}`}
							title={status.error ?? `${status.itemCount} items fetched`}>
							{status.title}
						</span>
					))}
				</div>
			</div>

			<div
				ref={parentRef}
				className='relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3'
				role='feed'
				aria-busy={isLoading}>
				{column.items.length === 0 ?
					<div className='rounded-3xl border border-dashed border-white/10 bg-slate-950/50 p-6 text-sm text-slate-400'>
						{isLoading ? 'Loading stories…' : 'No stories landed in this column yet. Try refreshing again in a moment.'}
					</div>
				:	<div
						style={{
							height: `${virtualizer.getTotalSize()}px`,
							position: 'relative',
							width: '100%',
						}}>
						{virtualizer.getVirtualItems().map((virtualItem) => {
							const item = column.items[virtualItem.index];

							return (
								<div
									key={virtualItem.key}
									data-index={virtualItem.index}
									ref={virtualizer.measureElement}
									className='absolute left-0 top-0 w-full pb-4'
									style={{
										transform: `translateY(${virtualItem.start}px)`,
									}}>
									<FeedCard
										item={item}
										isRead={readItemIds.has(item.id)}
										onOpen={onOpenItem}
										onToggleRead={onToggleRead}
									/>
								</div>
							);
						})}
					</div>
				}
			</div>
		</section>
	);
}
