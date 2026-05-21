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

function splitPreviewText(text: string, maxLength: number) {
	if (text.length <= maxLength) {
		return {
			preview: text,
			continuation: '',
		};
	}

	const candidate = text.slice(0, Math.max(0, maxLength));
	const lastWhitespaceIndex = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\n'));
	const splitIndex = lastWhitespaceIndex >= Math.floor(maxLength * 0.65) ? lastWhitespaceIndex : maxLength;
	const preview = text.slice(0, splitIndex).trimEnd();
	const continuation = text.slice(splitIndex).trimStart();

	return {
		preview: `${preview}…`,
		continuation,
	};
}

function splitDisplayParagraphs(text: string) {
	const normalized = text.replace(/\r/g, '').trim();
	if (!normalized) {
		return [];
	}

	const explicitParagraphs = normalized
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);

	if (explicitParagraphs.length > 1) {
		return explicitParagraphs;
	}

	const sentences =
		normalized
			.match(/[^.!?]+(?:[.!?](?=\s|$)|$)/g)
			?.map((sentence) => sentence.trim())
			.filter(Boolean) ?? [];

	if (sentences.length >= 4) {
		const paragraphs: string[] = [];
		for (let index = 0; index < sentences.length; index += 3) {
			paragraphs.push(
				sentences
					.slice(index, index + 3)
					.join(' ')
					.trim(),
			);
		}

		return paragraphs.filter(Boolean);
	}

	return [normalized];
}

function normalizeComparableText(text: string) {
	return text
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function areLikelyDuplicateParagraphs(left: string, right: string) {
	const normalizedLeft = normalizeComparableText(left);
	const normalizedRight = normalizeComparableText(right);

	if (!normalizedLeft || !normalizedRight) {
		return false;
	}

	if (normalizedLeft === normalizedRight) {
		return true;
	}

	if (normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft)) {
		return Math.min(normalizedLeft.length, normalizedRight.length) >= 80;
	}

	const leftWords = normalizedLeft.split(' ');
	const rightWords = normalizedRight.split(' ');
	const sampleLength = Math.min(leftWords.length, rightWords.length, 24);
	if (sampleLength < 12) {
		return false;
	}

	let sharedPrefixWords = 0;
	while (sharedPrefixWords < sampleLength && leftWords[sharedPrefixWords] === rightWords[sharedPrefixWords]) {
		sharedPrefixWords += 1;
	}

	return sharedPrefixWords >= Math.max(12, Math.floor(sampleLength * 0.7));
}

function trimDuplicateLeadParagraphs(bodyText: string, teaserText?: string) {
	const paragraphs = splitDisplayParagraphs(bodyText);
	if (!teaserText || paragraphs.length === 0) {
		return paragraphs;
	}

	let startIndex = 0;
	while (startIndex < paragraphs.length && areLikelyDuplicateParagraphs(paragraphs[startIndex], teaserText)) {
		startIndex += 1;
	}

	return paragraphs.slice(startIndex);
}

export function FeedCard({ item, isRead, onOpen, onToggleRead }: FeedCardProps) {
	const [isImageExpanded, setIsImageExpanded] = useState(false);
	const [isTextExpanded, setIsTextExpanded] = useState(false);
	const hasVideo = Boolean(item.videoEmbedUrl || item.videoUrl);
	const summaryText = item.summary?.trim() || '';
	const bodyText = item.content?.trim() || '';
	const hasDistinctBody = bodyText.length > 0 && normalizeComparableText(bodyText) !== normalizeComparableText(summaryText);
	const previewSegments = useMemo(() => {
		if (summaryText) {
			return {
				preview: summaryText,
				continuation: '',
			};
		}

		return splitPreviewText(bodyText || 'Open the source to read the full story.', COLLAPSED_PREVIEW_CHARS);
	}, [bodyText, summaryText]);
	const displayedPreviewText = previewSegments.preview;
	const expandedParagraphs = useMemo(() => {
		if (summaryText && hasDistinctBody) {
			return trimDuplicateLeadParagraphs(bodyText, summaryText);
		}

		return splitDisplayParagraphs(previewSegments.continuation);
	}, [bodyText, hasDistinctBody, previewSegments.continuation, summaryText]);
	const supplementalImages = item.additionalImageUrls ?? [];
	const hasExpandableContent = expandedParagraphs.length > 0 || supplementalImages.length > 0;

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

					<p className='text-[15px] leading-7 whitespace-pre-wrap text-slate-200/95'>{displayedPreviewText}</p>
				</div>

				{hasExpandableContent ?
					<button
						type='button'
						onClick={() => setIsTextExpanded((current) => !current)}
						className='mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-100'
						aria-expanded={isTextExpanded}
						aria-label={`${isTextExpanded ? 'Collapse' : 'Expand'} article text for ${item.title}`}>
						{isTextExpanded ? 'Show less' : 'Read more'}
					</button>
				:	null}

				{isTextExpanded && hasExpandableContent ?
					<div className='mt-4 clear-both space-y-4 text-[15px] leading-7 text-slate-100'>
						{expandedParagraphs.map((paragraph, index) => (
							<p key={`${item.id}-paragraph-${index}`}>{paragraph}</p>
						))}

						{supplementalImages.length > 0 ?
							<div className='grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2'>
								{supplementalImages.map((imageUrl, index) => (
									<a
										key={`${item.id}-image-${index}`}
										href={imageUrl}
										target='_blank'
										rel='noreferrer'
										className='group overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70'>
										{/* eslint-disable-next-line @next/next/no-img-element -- third-party article images come from many dynamic remote domains. */}
										<img
											src={imageUrl}
											alt={`${item.title} image ${index + 2}`}
											loading='lazy'
											className='aspect-video w-full object-cover transition duration-200 group-hover:scale-[1.02]'
										/>
									</a>
								))}
							</div>
						:	null}
					</div>
				:	null}

				<p className='mt-3 clear-left text-xs text-slate-500'>Source: {hostnameFromUrl(item.url)}</p>
			</div>
		</article>
	);
}
