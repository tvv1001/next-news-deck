'use client';

import { useMemo, useState } from 'react';

import { FeedItem } from '@/lib/feeds/types';

interface FeedCardProps {
	item: FeedItem;
	isRead: boolean;
	onOpen: (itemId: string) => void;
	onToggleRead: (itemId: string) => void;
}

function formatTimestamp(timestamp: string) {
	const date = new Date(timestamp);

	if (Number.isNaN(date.getTime())) {
		return 'Date unavailable';
	}

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

function isDirectVideoUrl(url: string) {
	return /\.(?:mp4|webm|ogg|m3u8)(?:$|[?#])/i.test(url);
}

const COLLAPSED_PREVIEW_CHARS = 340;

function truncatePreviewText(text: string, maxLength: number) {
	if (text.length <= maxLength) {
		return text;
	}

	return `${text.slice(0, Math.max(0, maxLength)).trimEnd()}…`;
}

export function FeedCard({ item, isRead, onOpen, onToggleRead }: FeedCardProps) {
	const [isImageExpanded, setIsImageExpanded] = useState(false);
	const [isTextExpanded, setIsTextExpanded] = useState(false);
	const hasVideo = Boolean(item.videoEmbedUrl || item.videoUrl);
	const bodyPreview = item.content && item.content !== item.summary ? item.content : undefined;
	const previewText = useMemo(() => {
		if (bodyPreview) {
			return item.summary && !bodyPreview.startsWith(item.summary) ? `${item.summary}\n\n${bodyPreview}` : bodyPreview;
		}

		return item.summary || 'Open the source to read the full story.';
	}, [bodyPreview, item.summary]);
	const displayedPreviewText = isTextExpanded ? previewText : truncatePreviewText(previewText, COLLAPSED_PREVIEW_CHARS);

	const imageButtonClassName = `group text-left transition ${isImageExpanded || hasVideo ? 'mb-3 block w-full' : 'mb-2 mr-4 float-left w-[43%]'}`;

	return (
		<article
			className={`rounded-3xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${
				isRead ? 'border-white/10 bg-slate-950/50 text-slate-400' : 'border-white/15 bg-slate-950/80 text-slate-50'
			}`}>
			<div className='mb-4 flex items-start justify-between gap-3'>
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
				<h3 className='text-lg font-semibold leading-7 text-balance transition group-hover:text-cyan-200'>{item.title}</h3>
			</a>

			<div className='mt-4 overflow-hidden'>
				{hasVideo ?
					<div className='mb-3 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70'>
						{item.videoEmbedUrl ?
							<iframe
								src={item.videoEmbedUrl}
								title={`Embedded video for ${item.title}`}
								className='aspect-video w-full'
								allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
								allowFullScreen
							/>
						: item.videoUrl && isDirectVideoUrl(item.videoUrl) ?
							<video
								src={item.videoUrl}
								controls
								preload='metadata'
								className='aspect-video w-full bg-black'
							/>
						: item.videoUrl ?
							<a
								href={item.videoUrl}
								target='_blank'
								rel='noreferrer'
								onClick={() => onOpen(item.id)}
								className='block px-3 py-2 text-sm font-medium text-cyan-200 transition hover:text-cyan-100'>
								Open video
							</a>
						:	null}
					</div>
				:	null}

				<div className={`text-left transition ${isTextExpanded ? 'text-slate-100' : 'text-slate-200/95'}`}>
					{item.imageUrl ?
						<button
							type='button'
							onClick={() => setIsImageExpanded((current) => !current)}
							className={imageButtonClassName}
							aria-expanded={isImageExpanded}
							aria-label={`${isImageExpanded ? 'Collapse' : 'Expand'} image for ${item.title}`}>
							{/* eslint-disable-next-line @next/next/no-img-element -- third-party article images come from many dynamic remote domains. */}
							<img
								src={item.imageUrl}
								alt={item.title}
								loading='lazy'
								className={`h-auto w-full rounded-2xl object-cover shadow-sm transition duration-200 group-hover:scale-[1.02] ${isImageExpanded ? 'max-h-112' : 'aspect-video'}`}
							/>
							<span className='mt-1 block px-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400'>
								{isImageExpanded ? 'Click to collapse' : 'Click to expand'}
							</span>
						</button>
					:	null}

					<p className={`text-[15px] leading-7 transition ${isTextExpanded ? 'whitespace-pre-wrap' : 'whitespace-pre-wrap'}`}>{displayedPreviewText}</p>
				</div>

				<button
					type='button'
					onClick={() => setIsTextExpanded((current) => !current)}
					className='mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-100'
					aria-expanded={isTextExpanded}
					aria-label={`${isTextExpanded ? 'Collapse' : 'Expand'} article text for ${item.title}`}>
					{isTextExpanded ? 'Show less' : 'Read more'}
				</button>

				<p className='mt-3 clear-left text-xs text-slate-500'>Source: {hostnameFromUrl(item.url)}</p>
			</div>
		</article>
	);
}
