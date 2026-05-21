import { load } from 'cheerio';

import { sanitizeArticleImageUrl, stripHtml } from '@/lib/feeds/normalize';

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
const CSS_KEYWORD_PATTERN =
	/\b(?:font-family|font-size|background(?:-color|-image)?|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|display|position|grid-template|grid-column|grid-row|flex(?:-[a-z]+)?|justify-content|align-items|border(?:-[a-z]+)?|color|width|height|min-width|max-width|min-height|max-height|line-height|z-index|opacity|transform|transition|animation)\s*:/i;
const CSS_SELECTOR_BLOCK_PATTERN = /(?:^|\s)[.#]?[a-z][a-z0-9_-]*(?:\s+[.#]?[a-z][a-z0-9_-]*)*\s*\{[^}]+\}/i;
const CSS_AT_RULE_PATTERN = /@(?:media|supports|keyframes|font-face|import)\b/i;

type CheerioElement = Parameters<ReturnType<typeof load>>[0];

export interface ArticleMetadata {
	title?: string;
	author?: string;
	publishedDate?: string;
	category?: string;
	imageUrl?: string;
	linkedDocuments?: Array<{ url: string; title: string; isPdf: boolean }>;
}

/**
 * Detects PDF links and other document references in article content.
 * Limited to avoid performance degradation.
 */
function detectLinkedDocuments(html: string): ArticleMetadata['linkedDocuments'] {
	const $ = load(html);
	const docs: ArticleMetadata['linkedDocuments'] = [];
	const seen = new Set<string>();

	// Scan for PDF links and research documents
	$('a[href]')
		.slice(0, 20)
		.each((_, elem) => {
			const href = $(elem).attr('href');
			const title = $(elem).text().trim();

			if (!href || !title || seen.has(href)) {
				return;
			}

			try {
				const url = new URL(href, 'https://example.com');
				const isPdf = /\.pdf/i.test(url.pathname);
				const isDocLink = /\b(document|paper|filing|report|whitepaper|research|pdf|download)\b/i.test(title);

				if ((isPdf || isDocLink) && url.protocol.startsWith('http')) {
					seen.add(href);
					docs.push({
						url: href,
						title,
						isPdf,
					});
				}
			} catch {
				// Skip invalid URLs
			}
		});

	return docs.length > 0 ? docs : undefined;
}

/**
 * Extract author from meta tags or byline elements.
 * Site-specific patterns for BBC, Reuters, NPR, Guardian, etc.
 */
function extractAuthor(html: string): string | undefined {
	const $ = load(html);
	const selectors = [
		'meta[name="author"]',
		'meta[property="article:author"]',
		'*[rel="author"]',
		'.byline',
		'.by-line',
		'.author',
		'.writer',
		'[data-testid="byline"]', // BBC
		'.sc-4fedabbc-5', // BBC News specific
		'.article-byline',
		'span.author',
		'p.author',
	];

	for (const selector of selectors) {
		const el = $(selector).first();
		if (el.length) {
			const content = el.attr('content') || el.text();
			const author = stripHtml(content).trim();
			if (author && author.length > 2 && author.length < 200) {
				return author;
			}
		}
	}

	return undefined;
}

/**
 * Extract publish date from meta tags or time elements.
 */
function extractPublishedDate(html: string): string | undefined {
	const $ = load(html);
	const selectors = ['meta[property="article:published_time"]', 'meta[name="datePublished"]', 'meta[itemprop="datePublished"]', 'time[datetime]'];

	for (const selector of selectors) {
		const el = $(selector).first();
		if (el.length) {
			const content = el.attr('content') || el.attr('datetime');
			if (content) {
				return content;
			}
		}
	}

	return undefined;
}

function extractLeadImage(html: string, pageUrl: string): string | undefined {
	const $ = load(html);
	const candidates = [
		$('meta[property="og:image"]').attr('content'),
		$('meta[name="twitter:image"]').attr('content'),
		$('link[rel="image_src"]').attr('href'),
		$('article img').first().attr('src') || $('article img').first().attr('data-src'),
		$('main img').first().attr('src') || $('main img').first().attr('data-src'),
		$('img').first().attr('src') || $('img').first().attr('data-src'),
	];

	for (const candidate of candidates) {
		const imageUrl = sanitizeArticleImageUrl(candidate, pageUrl);
		if (imageUrl) {
			return imageUrl;
		}
	}

	return undefined;
}

/**
 * Infer article category from URL path or page structure.
 */
function inferCategory(html: string, url: string): string | undefined {
	const urlLower = url.toLowerCase();

	// Try URL-based inference first (fast path)
	const categoryMappings: Array<[RegExp, string]> = [
		[/\/news\//i, 'News'],
		[/\/tech|\/technology/i, 'Technology'],
		[/\/business|\/finance/i, 'Business'],
		[/\/science/i, 'Science'],
		[/\/politics|\/government/i, 'Politics'],
		[/\/sports/i, 'Sports'],
		[/\/opinion|\/commentary/i, 'Opinion'],
	];

	for (const [pattern, category] of categoryMappings) {
		if (pattern.test(urlLower)) {
			return category;
		}
	}

	return undefined;
}

function normalizeWhitespace(text: string) {
	return text.replace(WHITESPACE_PATTERN, ' ').trim();
}

function looksLikeCssText(text: string) {
	const normalized = text.trim();
	if (normalized.length < MIN_PARAGRAPH_CHARS) {
		return false;
	}

	const cssSignalCount = [CSS_KEYWORD_PATTERN, CSS_SELECTOR_BLOCK_PATTERN, CSS_AT_RULE_PATTERN].filter((pattern) => pattern.test(normalized)).length;
	const punctuationCount = (normalized.match(/[{};]/g) ?? []).length;
	const wordCount = normalized.split(/\s+/).filter(Boolean).length;

	if (cssSignalCount >= 2) {
		return true;
	}

	if (cssSignalCount >= 1 && punctuationCount >= 6) {
		return true;
	}

	return punctuationCount >= 12 && punctuationCount > wordCount / 2;
}

function sanitizeExtractedText(text: string) {
	const normalized = normalizeWhitespace(text);
	return looksLikeCssText(normalized) ? '' : normalized;
}

function extractTextFromElement($: ReturnType<typeof load>, element: CheerioElement) {
	const paragraphs = $(element)
		.find('p')
		.map((_, node) => sanitizeExtractedText($(node).text()))
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
	return sanitizeExtractedText(stripHtml(html));
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

	const bodyText = sanitizeExtractedText(stripHtml($('body').html() ?? ''));
	return bodyText.length > bestCandidate.length ? bodyText : bestCandidate;
}

/**
 * Extract article metadata (author, date, category, linked docs).
 * Optimized for quick extraction without scanning entire DOM.
 */
export function extractArticleMetadata(html: string, url: string): ArticleMetadata {
	return {
		author: extractAuthor(html),
		publishedDate: extractPublishedDate(html),
		category: inferCategory(html, url),
		imageUrl: extractLeadImage(html, url),
		linkedDocuments: detectLinkedDocuments(html),
	};
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
			return { text: '', metadata: {} };
		}

		const contentType = response.headers.get('content-type') ?? '';
		if (!contentType.includes('text/html')) {
			return { text: '', metadata: {} };
		}

		const html = await response.text();
		const text = extractArticleText(html);
		const metadata = extractArticleMetadata(html, url);

		return { text, metadata };
	} catch {
		return { text: '', metadata: {} };
	} finally {
		clearTimeout(timeout);
	}
}
