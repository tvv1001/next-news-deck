'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { FeedColumn } from '@/components/dashboard/FeedColumn';
import { FeedColumnData } from '@/lib/feeds/types';

interface SortableColumnProps {
	column: FeedColumnData;
	isLoading: boolean;
	readItemIds: Set<string>;
	onOpenItem: (itemId: string) => void;
	onToggleRead: (itemId: string) => void;
	onRemoveCustomColumn?: (columnId: string) => void;
}

export function SortableColumn({ column, isLoading, readItemIds, onOpenItem, onToggleRead, onRemoveCustomColumn }: SortableColumnProps) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id });
	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};
	const isCustom = column.id.startsWith('custom-');

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`flex h-full min-h-0 min-w-[20rem] flex-1 ${isDragging ? 'z-10 opacity-80' : ''}`}>
			<FeedColumn
				column={column}
				isLoading={isLoading}
				readItemIds={readItemIds}
				onOpenItem={onOpenItem}
				onToggleRead={onToggleRead}
				headerActions={
					<div className='flex items-center justify-end gap-2'>
						{isCustom ?
							<button
								type='button'
								onClick={() => onRemoveCustomColumn?.(column.id)}
								className='rounded-full border border-rose-300/20 px-3 py-1 text-xs font-medium text-rose-100 transition hover:border-rose-300/40 hover:text-white'>
								Remove
							</button>
						:	null}
						<button
							type='button'
							className='cursor-grab rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-slate-100 transition hover:border-cyan-300/40 hover:text-cyan-100 active:cursor-grabbing'
							aria-label={`Drag ${column.title}`}
							{...attributes}
							{...listeners}>
							Drag
						</button>
					</div>
				}
			/>
		</div>
	);
}
