import { load } from 'cheerio';

import { stripHtml } from '@/lib/feeds/normalize';

const NOISE_SELECTORS = [
	'script',
	'style',
	'noscript',
	'svg',
	'canvas',
	'iframe',
	'header',
	'footer',
	'nav',
	'form',
	'aside',
	'[role="navigation"]',
	'[role="complementary"]',
	'[aria-hidden="true"]',
	'.footer',
	'.site-footer',
	'.global-footer',
	'.page-footer',
	'.advertisement',
	'.ad',
	'.ads',
	'.ad-slot',
	'.ad-container',
	'.sponsored',
	'.sponsor',
	'.newsletter',
	'.subscribe',
	'.social-share',
	'.share',
	'.related',
	'.recommended',
	'.promo',
	'.banner',
	'.comments',
	'[class*="ad-"]',
	'[id*="ad-"]',
	'[id^="ad_"]',
	'[aria-label*="advert"]',
];

const ARTICLE_SELECTORS = [
	'article',
	'main',
	'[role="main"]',
	'.article-body',
	'.article-content',
	'.article-body__content',
	'.article-content__content',
	'.story-body',
	'.story-content',
	'.storytext',
	'.storytext__content',
	'.storytext__text',
	'.storytext__paragraph',
	'#storytext',
	'.post-content',
	'.entry-content',
	'.main-content',
	'#main-content',
	'.sc-4fedabbc-3', // BBC News specific
	'.content',
	'#content',
];

const MIN_EXTRACTED_TEXT_LENGTH = 400; // Minimum chars to consider a valid extraction

const WHITESPACE_PATTERN = /\s+/g;
const MIN_PARAGRAPH_CHARS = 40;

type CheerioElement = Parameters<ReturnType<typeof load>>[0];

function normalizeWhitespace(text: string) {
	return text.replace(WHITESPACE_PATTERN, ' ').trim();
}

function extractTextFromElement($: ReturnType<typeof load>, element: CheerioElement) {
	const paragraphs = $(element)
		.find('p')
		.map((_, node) => normalizeWhitespace($(node).text()))
		.get()
		.filter((text) => text.length >= MIN_PARAGRAPH_CHARS && !text.match(/^(share|follow|live|more)/i));

	if (paragraphs.length > 0) {
		// Deduplicate sequential duplicates
		const deduped = [];
		let prevText = '';
		for (const text of paragraphs) {
			if (text !== prevText) {
				deduped.push(text);
				prevText = text;
			}
		}
		return deduped.join(' ');
	}

	const html = $(element).html() ?? '';
	return normalizeWhitespace(stripHtml(html));
}

export function extractArticleText(html: string) {
	const $ = load(html);
	for (const selector of NOISE_SELECTORS) {
		$(selector).remove();
	}

	let bestCandidate = '';
	for (const selector of ARTICLE_SELECTORS) {
		const nodes = $(selector).toArray();
		for (const node of nodes) {
			const text = extractTextFromElement($, node);
			if (text.length > bestCandidate.length) {
				bestCandidate = text;
			}
		}
	}

	if (bestCandidate.length >= MIN_EXTRACTED_TEXT_LENGTH) {
		return bestCandidate;
	}

	// Fallback: scan all divs with article-like attributes
	$('div[class*="article"], div[class*="content"], div[class*="story"]').each((_, elem) => {
		const text = extractTextFromElement($, elem);
		if (text.length > bestCandidate.length && text.length >= MIN_EXTRACTED_TEXT_LENGTH) {
			bestCandidate = text;
		}
	});

	if (bestCandidate.length >= MIN_EXTRACTED_TEXT_LENGTH) {
		return bestCandidate;
	}

	const bodyText = normalizeWhitespace(stripHtml($('body').html() ?? ''));
	return bodyText.length > bestCandidate.length ? bodyText : bestCandidate;
}

export async function fetchArticleText(url: string, headers: HeadersInit, timeoutMs: number) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			headers,
			signal: controller.signal,
			next: { revalidate: 0 },
		});

		if (!response.ok) {
			return '';
		}

		const contentType = response.headers.get('content-type') ?? '';
		if (!contentType.includes('text/html')) {
			return '';
		}

		const html = await response.text();
		return extractArticleText(html);
	} catch {
		return '';
	} finally {
		clearTimeout(timeout);
	}
}
