'use client';

import { useMemo, useState } from 'react';

import { PINNED_RIGHT_COLUMN_ID, RESERVED_CUSTOM_SOURCE_IDS } from '@/lib/config/default-columns';
import { FeedColumnConfig, FeedSourceConfig, FeedVelocity } from '@/lib/feeds/types';

interface ColumnComposerProps {
	availableSources: FeedSourceConfig[];
	columns: FeedColumnConfig[];
	visibleColumnIds: string[];
	onToggleColumn: (columnId: string) => void;
	onAddCustomColumn: (column: FeedColumnConfig) => void;
	onRemoveCustomColumn: (columnId: string) => void;
}

const ACCENT_PALETTES = [
	{ from: 'from-emerald-500/25', to: 'to-teal-400/10' },
	{ from: 'from-rose-500/25', to: 'to-pink-400/10' },
	{ from: 'from-indigo-500/25', to: 'to-sky-400/10' },
	{ from: 'from-lime-500/25', to: 'to-emerald-400/10' },
	{ from: 'from-purple-500/25', to: 'to-violet-400/10' },
];

function slugify(input: string) {
	return input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
}

export function ColumnComposer({ availableSources, columns, visibleColumnIds, onToggleColumn, onAddCustomColumn, onRemoveCustomColumn }: ColumnComposerProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [velocity, setVelocity] = useState<FeedVelocity>('fast');
	const [maxItems, setMaxItems] = useState('24');
	const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
	const [formError, setFormError] = useState<string | null>(null);

	const customColumnCount = useMemo(() => columns.filter((column) => column.id.startsWith('custom-')).length, [columns]);
	const selectableSources = useMemo(
		() => availableSources.filter((source) => !RESERVED_CUSTOM_SOURCE_IDS.includes(source.id as (typeof RESERVED_CUSTOM_SOURCE_IDS)[number])),
		[availableSources],
	);

	function resetForm() {
		setTitle('');
		setDescription('');
		setVelocity('fast');
		setMaxItems('24');
		setSelectedSourceIds([]);
		setFormError(null);
	}

	function toggleSource(sourceId: string) {
		setSelectedSourceIds((current) => (current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]));
	}

	function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		const nextTitle = title.trim();
		const nextMaxItems = Number(maxItems);

		if (!nextTitle) {
			setFormError('Give the column a title first.');
			return;
		}

		if (selectedSourceIds.length === 0) {
			setFormError('Choose at least one non-crawl source for the custom column.');
			return;
		}

		if (!Number.isFinite(nextMaxItems) || nextMaxItems < 6 || nextMaxItems > 60) {
			setFormError('Pick a max item count between 6 and 60.');
			return;
		}

		const palette = ACCENT_PALETTES[customColumnCount % ACCENT_PALETTES.length];
		const idBase = slugify(nextTitle) || 'custom-column';

		onAddCustomColumn({
			id: `custom-${idBase}-${globalThis.crypto.randomUUID().slice(0, 8)}`,
			title: nextTitle,
			description: description.trim() || `Custom blend from ${selectedSourceIds.length} source${selectedSourceIds.length === 1 ? '' : 's'}.`,
			velocity,
			sourceIds: selectedSourceIds,
			maxItems: nextMaxItems,
			accentFrom: palette.from,
			accentTo: palette.to,
		});

		resetForm();
		setIsOpen(false);
	}

	return (
		<div className='mt-2 text-xs text-slate-300'>
			<div className='flex flex-wrap items-center gap-1.5'>
				<button
					type='button'
					onClick={() => setIsOpen((current) => !current)}
					className='rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-medium text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-400/15'>
					{isOpen ? 'Close' : 'Custom'}
				</button>

				{columns.map((column) => {
					const isVisible = visibleColumnIds.includes(column.id);
					const isCustom = column.id.startsWith('custom-');
					const isPinnedRight = column.id === PINNED_RIGHT_COLUMN_ID;

					return (
						<div
							key={column.id}
							className='flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1'>
							<button
								type='button'
								onClick={() => onToggleColumn(column.id)}
								disabled={isPinnedRight}
								className={`text-[11px] font-medium transition ${
									isPinnedRight ? 'text-emerald-100/90'
									: isVisible ? 'text-cyan-100'
									: 'text-slate-400 hover:text-white'
								}`}>
								{column.title}
							</button>
							{isPinnedRight ?
								<span className='text-[10px] text-emerald-200/80'>Right</span>
							:	null}
							{isCustom ?
								<button
									type='button'
									onClick={() => onRemoveCustomColumn(column.id)}
									className='rounded-full border border-rose-300/20 px-1.5 py-0.5 text-[10px] text-rose-200 transition hover:border-rose-300/40 hover:text-white'
									aria-label={`Remove ${column.title}`}>
									×
								</button>
							:	null}
						</div>
					);
				})}
			</div>

			{isOpen ?
				<form
					onSubmit={handleSubmit}
					className='mt-2 grid gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3 lg:grid-cols-[1.2fr_0.8fr]'>
					<div className='space-y-3'>
						<div>
							<label
								htmlFor='custom-title'
								className='mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400'>
								Title
							</label>
							<input
								id='custom-title'
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								placeholder='Deep tech watch'
								className='w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/40'
							/>
						</div>

						<div>
							<label
								htmlFor='custom-description'
								className='mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400'>
								Description
							</label>
							<input
								id='custom-description'
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								placeholder='Optional note'
								className='w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/40'
							/>
						</div>

						<div className='grid gap-3 sm:grid-cols-2'>
							<div>
								<label
									htmlFor='custom-velocity'
									className='mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400'>
									Velocity
								</label>
								<select
									id='custom-velocity'
									value={velocity}
									onChange={(event) => setVelocity(event.target.value as FeedVelocity)}
									className='w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/40'>
									<option value='fast'>Fast lane</option>
									<option value='slow'>Watch lane</option>
								</select>
							</div>
							<div>
								<label
									htmlFor='custom-max-items'
									className='mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400'>
									Max items
								</label>
								<input
									id='custom-max-items'
									type='number'
									min={6}
									max={60}
									value={maxItems}
									onChange={(event) => setMaxItems(event.target.value)}
									className='w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/40'
								/>
							</div>
						</div>
					</div>

					<div>
						<p className='mb-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400'>Sources</p>
						<div className='grid max-h-52 gap-2 overflow-y-auto rounded-xl border border-white/10 bg-slate-900/80 p-2'>
							{selectableSources.map((source) => {
								const isSelected = selectedSourceIds.includes(source.id);

								return (
									<label
										key={source.id}
										className={`rounded-xl border px-2.5 py-2 transition ${isSelected ? 'border-cyan-300/40 bg-cyan-400/10' : 'border-white/10 hover:border-white/20'}`}>
										<div className='flex items-start gap-2.5'>
											<input
												type='checkbox'
												checked={isSelected}
												onChange={() => toggleSource(source.id)}
												className='mt-0.5'
											/>
											<div>
												<p className='text-[11px] font-medium text-white'>{source.title}</p>
												<p className='mt-1 text-[10px] leading-4 text-slate-400'>{source.description}</p>
											</div>
										</div>
									</label>
								);
							})}
						</div>
					</div>

					<div className='flex flex-col gap-2 lg:col-span-2 sm:flex-row sm:items-center sm:justify-between'>
						<div>
							{formError ?
								<p className='text-xs text-rose-200'>{formError}</p>
							:	<p className='text-[11px] text-slate-400'>Pick sources to blend into one extra column. Crawl search stays pinned in the right lane.</p>}
						</div>
						<div className='flex gap-2'>
							<button
								type='button'
								onClick={resetForm}
								className='rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-white/20 hover:text-white'>
								Reset
							</button>
							<button
								type='submit'
								className='rounded-full bg-cyan-400 px-3 py-1.5 text-[11px] font-medium text-slate-950 transition hover:bg-cyan-300'>
								Add column
							</button>
						</div>
					</div>
				</form>
			:	null}
		</div>
	);
}
