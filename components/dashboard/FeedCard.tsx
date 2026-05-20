'use client';

import { useState } from 'react';

import { FeedItem } from '@/lib/feeds/types';

interface FeedCardProps {
	item: FeedItem;
	isRead: boolean;
	onOpen: (itemId: string) => void;
	onToggleRead: (itemId: string) => void;
}

function formatTimestamp(timestamp: string) {
	const date = new Date(timestamp);

	return new Intl.DateTimeFormat('en', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).format(date);
}

function hostnameFromUrl(url: string) {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

function discoveryLabel(source?: FeedItem['discoverySource']) {
	if (source === 'bing') {
		return 'via Bing';
	}

	if (source === 'google') {
		return 'via Google';
	}

	return '';
}

export function FeedCard({ item, isRead, onOpen, onToggleRead }: FeedCardProps) {
	const [isImageExpanded, setIsImageExpanded] = useState(false);

	return (
		<>
			<article
				className={`rounded-3xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${
					isRead ? 'border-white/10 bg-slate-950/50 text-slate-400' : 'border-white/15 bg-slate-950/80 text-slate-50'
				}`}>
				<div className='mb-3 flex items-start justify-between gap-3'>
					<div>
						<div className='flex flex-wrap items-center gap-2'>
							<p className='text-xs font-medium uppercase tracking-[0.24em] text-cyan-300/90'>{item.sourceName}</p>
							{item.discoverySource ?
								<span className='rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200'>
									{discoveryLabel(item.discoverySource)}
								</span>
							:	null}
						</div>
						<p className='mt-1 text-xs text-slate-400'>{formatTimestamp(item.publishedAt)}</p>
					</div>
					<button
						type='button'
						onClick={() => onToggleRead(item.id)}
						className='rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-100'
						aria-pressed={isRead}>
						{isRead ? 'Unread' : 'Mark read'}
					</button>
				</div>

				<a
					href={item.url}
					target='_blank'
					rel='noreferrer'
					onClick={() => onOpen(item.id)}
					className='group block'>
					<h3 className='text-base font-semibold leading-6 text-balance transition group-hover:text-cyan-200'>{item.title}</h3>
				</a>

				<div className='mt-3 overflow-hidden'>
					{item.imageUrl ?
						<button
							type='button'
							onClick={() => setIsImageExpanded(true)}
							className='group mb-2 mr-3 float-left w-2/5 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 text-left transition hover:border-cyan-300/40'
							aria-label={`Expand image for ${item.title}`}>
							{/* eslint-disable-next-line @next/next/no-img-element -- third-party article images come from many dynamic remote domains. */}
							<img
								src={item.imageUrl}
								alt={item.title}
								loading='lazy'
								className='aspect-video h-auto w-full object-cover transition group-hover:scale-[1.02]'
							/>
							<span className='block border-t border-white/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-300'>Click to expand</span>
						</button>
					:	null}

					<a
						href={item.url}
						target='_blank'
						rel='noreferrer'
						onClick={() => onOpen(item.id)}
						className='group block'>
						<p className='line-clamp-4 text-sm leading-6 text-slate-300/90'>{item.summary || 'Open the source to read the full story.'}</p>
					</a>
				</div>
			</article>

			{isImageExpanded && item.imageUrl ?
				<button
					type='button'
					onClick={() => setIsImageExpanded(false)}
					className='fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-6 backdrop-blur-sm'
					aria-label={`Close expanded image for ${item.title}`}>
					<div className='flex max-h-full max-w-4xl flex-col items-center gap-3'>
						{/* eslint-disable-next-line @next/next/no-img-element -- third-party article images come from many dynamic remote domains. */}
						<img
							src={item.imageUrl}
							alt={item.title}
							className='max-h-[80vh] w-auto max-w-full rounded-3xl border border-white/10 shadow-2xl'
						/>
						<span className='rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-xs font-medium text-slate-100'>Click image or blur to close</span>
					</div>
				</button>
			:	null}
		</>
	);
}
