'use client';

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
	return (
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
				<p className='mt-3 line-clamp-4 text-sm leading-6 text-slate-300/90'>{item.summary || 'Open the source to read the full story.'}</p>
			</a>

			<div className='mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400'>
				<span className='rounded-full border border-white/10 px-2 py-1'>{hostnameFromUrl(item.url)}</span>
				{item.tags.slice(0, 3).map((tag) => (
					<span
						key={tag}
						className='rounded-full border border-white/10 px-2 py-1'>
						#{tag}
					</span>
				))}
			</div>
		</article>
	);
}
