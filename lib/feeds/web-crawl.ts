import { load } from 'cheerio';

import { runScrapyCrawler, ScrapyPage } from '@/lib/crawler/scrapy-runner';
import { buildDedupeKey, dedupeAndSortFeedItems, sanitizeArticleImageUrl, stripHtml, toIsoDate, truncate } from '@/lib/feeds/normalize';
import { FeedItem, FeedSourceConfig, FeedSourceResult } from '@/lib/feeds/types';

interface CrawlQueueItem {
	url: string;
	depth: number;
	discoverySource?: FeedItem['discoverySource'];
}

interface ExtractedPage {
	title: string;
	url: string;
	summary: string;
	publishedAt: string;
	imageUrl?: string;
	videoUrl?: string;
	videoEmbedUrl?: string;
	text: string;
	links: string[];
	fallbackLinks: string[];
	score: number;
	articleLike: boolean;
	discoverySource?: FeedItem['discoverySource'];
}

type JsonLdValue = null | boolean | number | string | JsonLdObject | JsonLdValue[];

interface JsonLdObject {
	[key: string]: JsonLdValue;
}

const DEFAULT_MAX_PAGES = 18;
const DEFAULT_CRAWL_DEPTH = 4;
const DEFAULT_MAX_ITEMS_PER_DOMAIN = 5;
const MIN_FALLBACK_MATCHES = 4;
const DESIRED_MIN_MATCHES = 8;
const MAX_LINKS_PER_PAGE = 50;
const MAX_ENRICHMENT_LINKS = 6;
const MAX_SEED_FALLBACK_CANDIDATES = 18;
const MAX_TEXT_LENGTH = 12_000;
const MIN_BODY_CHARS = 280;
const THIN_PAGE_TEXT_CHARS = 900;
const SEARCH_DISCOVERY_MIN_PAGES = 12;
const ARTICLE_TAIL_MARKERS = [/\bfrom our partners\b/i, /\bin other news\b/i, /\bshow comments\b/i, /\bcalculator and tools\b/i];

// Domain-level rate limiting (ms between requests per domain)
const DOMAIN_REQUEST_DELAY_MS = 300;
// Max concurrent domain crawls (to prevent resource exhaustion)
const MAX_CONCURRENT_DOMAINS = 2;
// Max requests per domain per crawl session
const MAX_REQUESTS_PER_DOMAIN = 8;
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
	'.advertisement',
	'.ad',
	'.ads',
	'.newsletter',
	'.subscribe',
	'.social-share',
	'.share',
	'.related',
	'.recommended',
	'.promo',
	'.banner',
	'.comments',
];
const BLOCKED_PATH_PATTERNS = [
	/\/tag\//i,
	/\/tags\//i,
	/\/category\//i,
	/\/author\//i,
	/\/search\//i,
	/\/?s=/i,
	/\/login/i,
	/\/signin/i,
	/\/account/i,
	/\/privacy/i,
	/\/terms/i,
	/\/about/i,
	/\/contact/i,
	/\/subscribe/i,
	/\/newsletter/i,
	/\/feed\/?$/i,
	/\/amp\/?$/i,
];
const BLOCKED_FILE_EXTENSIONS = /\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|xml|json|mp4|mp3|avi|mov|txt)$/i;
const OFFSITE_RESULT_PAGE_PREFIXES = ['/news/search', '/news/event', '/search'];
const MAX_PAGE_AGE_DAYS = 10;
const BLOCKED_COMMERCE_HOST_PATTERNS = [/^shopping\./i, /googleadservices\.com$/i, /doubleclick\.net$/i, /ads?\./i];
const BLOCKED_COMMERCE_URL_PATTERNS = [/\/shop(?:\/|$)/i, /\/shopping(?:\/|$)/i, /\/product(?:s)?(?:\/|$)/i, /\/deals?(?:\/|$)/i, /\/coupon/i, /\/offers?(?:\/|$)/i];
const BLOCKED_COMMERCE_TEXT_PATTERNS = [
	/\b(shop now|buy now|add to cart|for sale|limited time offer|promo code|coupon code|discount code|free shipping|black friday|cyber monday)\b/i,
	/\b(sponsored|advertisement|affiliate link|partner content|paid post)\b/i,
	/\b(price:\s*\$|sale price|compare prices|best price)\b/i,
];
const BLOCKED_STOCK_LANDING_URL_PATTERNS = [/finance\.yahoo\.com\/quote\//i, /cnbc\.com\/quotes\//i, /sec\.gov\/edgar\/browse/i, /ir\.tesla\.com\/?$/i];
const BLOCKED_STOCK_LANDING_TEXT_PATTERNS = [
	/\b(previous close|open|bid|ask|day'?s range|52 week range|market cap|beta|pe ratio|eps|earnings date|avg volume|forward dividend|ex-dividend date)\b/i,
	/\b(fair value|research report|my portfolio|watchlist|compare brokers|historical data|option chain)\b/i,
	/\b(quote overview|stock chart|analyst recommendations|key statistics|financial highlights)\b/i,
];
const BLOCKED_GENERIC_TEXT_PATTERNS = [
	/\b(if you invested|how rich you would be|price prediction|stock price in 20\d{2}|quotes every \d+-year-old)\b/i,
	/\b(stock of the day|what you need to know|top \d+ stocks|best .* stocks?|buy, sell, or hold)\b/i,
	/\b(weekly distribution|sec yield|dividend yield|growth & income etf|magnitude of returns)\b/i,
	/\b(list of|roundup of|everything you need to know)\b/i,
];

function buildHeaders(source: FeedSourceConfig): HeadersInit {
	return {
		'user-agent': source.userAgent ?? process.env.NEWS_DECK_USER_AGENT ?? 'next-news-deck/0.1 (+https://example.local)',
		'accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
	};
}

function toAbsoluteUrl(candidate: string, baseUrl: string) {
	try {
		const url = new URL(candidate, baseUrl);

		if (!['http:', 'https:'].includes(url.protocol)) {
			return null;
		}

		url.hash = '';
		return url.toString();
	} catch {
		return null;
	}
}

function sanitizeMediaUrl(candidate?: string, baseUrl?: string) {
	if (!candidate) {
		return undefined;
	}

	const resolved = toAbsoluteUrl(candidate.trim(), baseUrl ?? candidate.trim());
	return resolved ?? undefined;
}

function normalizeHost(hostname: string) {
	return hostname.replace(/^www\./i, '').toLowerCase();
}

function classifyDiscoverySource(url: string): FeedItem['discoverySource'] {
	try {
		const parsed = new URL(url);
		const host = normalizeHost(parsed.hostname);

		if (host.endsWith('bing.com')) {
			return 'bing';
		}

		if (host.endsWith('google.com') || host.endsWith('news.google.com')) {
			return 'google';
		}

		return undefined;
	} catch {
		return undefined;
	}
}

function canFollowOffsiteLinks(pageUrl: string) {
	try {
		const url = new URL(pageUrl);
		const host = normalizeHost(url.hostname);

		if (host === 'bing.com' || host === 'google.com' || host === 'news.google.com') {
			return OFFSITE_RESULT_PAGE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
		}

		return false;
	} catch {
		return false;
	}
}

function tokenizeQuery(query?: string) {
	return [...new Set((query ?? '').toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])];
}

function tokenizeSource(source: FeedSourceConfig) {
	return [...new Set([...tokenizeQuery(source.query), ...tokenizeQuery(source.title), ...tokenizeQuery(source.description), ...source.tags.flatMap((tag) => tokenizeQuery(tag))])];
}

function shouldSkipUrl(candidate: string) {
	try {
		const url = new URL(candidate);
		const normalized = `${url.pathname}${url.search}`;

		if (BLOCKED_FILE_EXTENSIONS.test(url.pathname)) {
			return true;
		}

		return BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
	} catch {
		return true;
	}
}

function isPdfUrl(candidate: string) {
	return /\.pdf(?:$|[?#])/i.test(candidate);
}

function shouldSkipFallbackUrl(candidate: string) {
	try {
		const url = new URL(candidate);
		const normalized = `${url.pathname}${url.search}`;

		if (BLOCKED_FILE_EXTENSIONS.test(url.pathname) && !isPdfUrl(candidate)) {
			return true;
		}

		return BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
	} catch {
		return true;
	}
}

function isSearchDiscoveryUrl(candidate: string) {
	if (classifyDiscoverySource(candidate)) {
		return true;
	}

	try {
		const url = new URL(candidate);
		return /\/(search|news)\b/i.test(url.pathname);
	} catch {
		return false;
	}
}

function extractAiSearchSnippet($: ReturnType<typeof load>, pageUrl: string) {
	const discoverySource = classifyDiscoverySource(pageUrl);
	if (!discoverySource) {
		return null;
	}

	const aiSnippetSelectors = ['.b_ans', '[data-attrid="ai_overview"]', '.ai-generated', '[data-component="ai-summary"]'];

	for (const selector of aiSnippetSelectors) {
		const snippet = $(selector).first();
		if (!snippet.length) {
			continue;
		}

		const text = stripHtml(snippet.text());
		if (text.length >= 150) {
			return text;
		}
	}

	return null;
}

function isStalePage(publishedAt: string) {
	if (!publishedAt) {
		return false;
	}

	const ageMs = Date.now() - new Date(publishedAt).getTime();
	if (Number.isNaN(ageMs)) {
		return false;
	}

	return ageMs > MAX_PAGE_AGE_DAYS * 24 * 60 * 60_000;
}

function matchesAnyPattern(value: string, patterns: RegExp[]) {
	return patterns.some((pattern) => pattern.test(value));
}

function shouldRejectPage(pageUrl: string, title: string, summary: string, text: string, publishedAt: string, options: { ignoreGenericTextPatterns?: boolean } = {}) {
	const combined = `${title}\n${summary}\n${text.slice(0, 3000)}`;
	const isLikelyThinPage = text.length < 1_600;

	try {
		const url = new URL(pageUrl);
		const host = normalizeHost(url.hostname);
		const normalizedUrl = `${host}${url.pathname}${url.search}`;

		if (BLOCKED_COMMERCE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
			return true;
		}

		if (matchesAnyPattern(normalizedUrl, BLOCKED_COMMERCE_URL_PATTERNS)) {
			return true;
		}

		if (matchesAnyPattern(normalizedUrl, BLOCKED_STOCK_LANDING_URL_PATTERNS)) {
			return true;
		}
	} catch {
		return true;
	}

	if (matchesAnyPattern(combined, BLOCKED_COMMERCE_TEXT_PATTERNS) && isLikelyThinPage) {
		return true;
	}

	if (matchesAnyPattern(combined, BLOCKED_STOCK_LANDING_TEXT_PATTERNS) && isLikelyThinPage) {
		return true;
	}

	if (!options.ignoreGenericTextPatterns && matchesAnyPattern(combined, BLOCKED_GENERIC_TEXT_PATTERNS) && isLikelyThinPage) {
		return true;
	}

	if (isStalePage(publishedAt)) {
		return true;
	}

	if (summary.length > 0 && summary.length < 48 && !publishedAt) {
		return true;
	}

	return false;
}

function shouldRejectDiscoverySnippet(pageUrl: string, title: string, summary: string) {
	const combined = `${title}\n${summary}`;

	try {
		const url = new URL(pageUrl);
		const host = normalizeHost(url.hostname);
		const normalizedUrl = `${host}${url.pathname}${url.search}`;

		if (BLOCKED_COMMERCE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
			return true;
		}

		if (matchesAnyPattern(normalizedUrl, BLOCKED_COMMERCE_URL_PATTERNS)) {
			return true;
		}

		if (matchesAnyPattern(normalizedUrl, BLOCKED_STOCK_LANDING_URL_PATTERNS)) {
			return true;
		}
	} catch {
		return true;
	}

	if (matchesAnyPattern(combined, BLOCKED_COMMERCE_TEXT_PATTERNS)) {
		return true;
	}

	if (matchesAnyPattern(combined, BLOCKED_STOCK_LANDING_TEXT_PATTERNS)) {
		return true;
	}

	return false;
}

function readMeta($: ReturnType<typeof load>, selectors: string[]) {
	for (const selector of selectors) {
		const value = $(selector).attr('content')?.trim() ?? $(selector).attr('datetime')?.trim() ?? '';

		if (value) {
			return value;
		}
	}

	return '';
}

function collectJsonLdObjects(value: JsonLdValue, objects: JsonLdObject[]) {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectJsonLdObjects(item, objects);
		}
		return;
	}

	if (!value || typeof value !== 'object') {
		return;
	}

	const object = value as JsonLdObject;
	objects.push(object);

	for (const nestedKey of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'subjectOf', 'hasPart', 'citation']) {
		if (nestedKey in object) {
			collectJsonLdObjects(object[nestedKey], objects);
		}
	}
}

function parseJsonLdBlocks($: ReturnType<typeof load>) {
	const objects: JsonLdObject[] = [];

	$('script[type="application/ld+json"]').each((_, element) => {
		const rawValue = $(element).contents().text().trim();
		if (!rawValue) {
			return;
		}

		try {
			collectJsonLdObjects(JSON.parse(rawValue) as JsonLdValue, objects);
		} catch {
			return;
		}
	});

	return objects;
}

function firstJsonLdText(value: JsonLdValue): string {
	if (typeof value === 'string') {
		return stripHtml(value.trim());
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const candidate = firstJsonLdText(item);
			if (candidate) {
				return candidate;
			}
		}
		return '';
	}

	if (!value || typeof value !== 'object') {
		return '';
	}

	const object = value as JsonLdObject;
	for (const key of ['headline', 'name', 'description', 'text', 'articleBody', 'caption']) {
		const candidate = firstJsonLdText(object[key]);
		if (candidate) {
			return candidate;
		}
	}

	return '';
}

function firstJsonLdUrl(value: JsonLdValue, baseUrl: string): string {
	if (typeof value === 'string') {
		return toAbsoluteUrl(value.trim(), baseUrl) ?? '';
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const candidate = firstJsonLdUrl(item, baseUrl);
			if (candidate) {
				return candidate;
			}
		}
		return '';
	}

	if (!value || typeof value !== 'object') {
		return '';
	}

	const object = value as JsonLdObject;
	for (const key of ['url', '@id', 'contentUrl', 'mainEntityOfPage', 'sameAs']) {
		const candidate = firstJsonLdUrl(object[key], baseUrl);
		if (candidate) {
			return candidate;
		}
	}

	return '';
}

function findStructuredText(objects: JsonLdObject[], keys: string[]) {
	for (const object of objects) {
		for (const key of keys) {
			const candidate = firstJsonLdText(object[key]);
			if (candidate) {
				return candidate;
			}
		}
	}

	return '';
}

function findStructuredUrl(objects: JsonLdObject[], keys: string[], baseUrl: string) {
	for (const object of objects) {
		for (const key of keys) {
			const candidate = firstJsonLdUrl(object[key], baseUrl);
			if (candidate) {
				return candidate;
			}
		}
	}

	return '';
}

function collectStructuredUrlsFromValue(value: JsonLdValue, baseUrl: string, urls: Set<string>) {
	if (typeof value === 'string') {
		const normalizedUrl = toAbsoluteUrl(value.trim(), baseUrl);
		if (normalizedUrl) {
			urls.add(normalizedUrl);
		}
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectStructuredUrlsFromValue(item, baseUrl, urls);
		}
		return;
	}

	if (!value || typeof value !== 'object') {
		return;
	}

	const object = value as JsonLdObject;
	for (const [key, nestedValue] of Object.entries(object)) {
		if (['url', '@id', 'contentUrl', 'mainEntityOfPage', 'sameAs', 'citation', 'mentions', 'subjectOf', 'hasPart', 'item', 'itemListElement', 'encoding'].includes(key)) {
			collectStructuredUrlsFromValue(nestedValue, baseUrl, urls);
		}
	}
}

function extractStructuredUrls(objects: JsonLdObject[], baseUrl: string) {
	const urls = new Set<string>();

	for (const object of objects) {
		collectStructuredUrlsFromValue(object, baseUrl, urls);
	}

	return [...urls];
}

function scoreFallbackLink(candidateUrl: string, anchorText: string, pageUrl: string, tokens: string[]) {
	const baseHost = normalizeHost(new URL(pageUrl).hostname);
	const candidateHost = normalizeHost(new URL(candidateUrl).hostname);
	const combined = `${anchorText} ${candidateUrl}`.toLowerCase();
	let score = 0;

	if (isPdfUrl(candidateUrl)) {
		score += 12;
	}

	if (candidateHost !== baseHost) {
		score += 5;
	}

	if (/\b(source|full report|official filing|investor relations|download|read full|view pdf|sec filing)\b/i.test(anchorText)) {
		score += 6;
	}

	if (isSearchDiscoveryUrl(candidateUrl)) {
		score -= 6;
	}

	for (const token of tokens) {
		if (combined.includes(token)) {
			score += 2;
		}
	}

	return score;
}

function extractFallbackLinks($: ReturnType<typeof load>, pageUrl: string, tokens: string[], structuredUrls: string[] = []) {
	const rankedLinks = new Map<string, number>();

	$('a[href]').each((_, element) => {
		const href = $(element).attr('href');
		if (!href) {
			return;
		}

		const candidateUrl = toAbsoluteUrl(href, pageUrl);
		if (!candidateUrl || candidateUrl === pageUrl || shouldSkipFallbackUrl(candidateUrl)) {
			return;
		}

		const anchorText = stripHtml($(element).text());
		const score = scoreFallbackLink(candidateUrl, anchorText, pageUrl, tokens);
		const existing = rankedLinks.get(candidateUrl) ?? Number.NEGATIVE_INFINITY;

		if (score > existing) {
			rankedLinks.set(candidateUrl, score);
		}
	});

	for (const candidateUrl of structuredUrls) {
		if (candidateUrl === pageUrl || shouldSkipFallbackUrl(candidateUrl)) {
			continue;
		}

		const score = scoreFallbackLink(candidateUrl, candidateUrl, pageUrl, tokens);
		const existing = rankedLinks.get(candidateUrl) ?? Number.NEGATIVE_INFINITY;

		if (score > existing) {
			rankedLinks.set(candidateUrl, score);
		}
	}

	return [...rankedLinks.entries()]
		.sort((left, right) => right[1] - left[1])
		.map(([candidateUrl]) => candidateUrl)
		.slice(0, MAX_ENRICHMENT_LINKS);
}

function readCanonicalUrl($: ReturnType<typeof load>, pageUrl: string, structuredData: JsonLdObject[]) {
	const canonical =
		$('link[rel="canonical"]').attr('href')?.trim() || readMeta($, ['meta[property="og:url"]']) || findStructuredUrl(structuredData, ['mainEntityOfPage', 'url', '@id'], pageUrl);

	return canonical ? (toAbsoluteUrl(canonical, pageUrl) ?? pageUrl) : pageUrl;
}

function readTitle($: ReturnType<typeof load>, structuredData: JsonLdObject[]) {
	return stripHtml(
		readMeta($, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
			findStructuredText(structuredData, ['headline', 'name']) ||
			$('article h1').first().text() ||
			$('main h1').first().text() ||
			$('h1').first().text() ||
			$('title').first().text(),
	);
}

function readSummary($: ReturnType<typeof load>, structuredData: JsonLdObject[]) {
	const paragraphs = $('.content-body p, .article-container p, .seamless-article p, article p, main p, p')
		.toArray()
		.map((element) => stripHtml($(element).text()))
		.filter((value) => value.length > 80);

	return truncate(
		stripHtml(
			readMeta($, ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) ||
				findStructuredText(structuredData, ['description', 'abstract']) ||
				paragraphs[0] ||
				$('article p').slice(0, 3).text() ||
				$('main p').slice(0, 3).text() ||
				$('p').slice(0, 3).text(),
		),
		220,
	);
}

function readImageUrl($: ReturnType<typeof load>, pageUrl: string, structuredData: JsonLdObject[]) {
	const candidates = [
		readMeta($, ['meta[property="og:image"]', 'meta[name="twitter:image"]']),
		findStructuredUrl(structuredData, ['image', 'thumbnailUrl'], pageUrl),
		$('article img').first().attr('src') || '',
		$('main img').first().attr('src') || '',
		$('img').first().attr('src') || '',
	];

	for (const candidate of candidates) {
		const sanitized = sanitizeArticleImageUrl(candidate, pageUrl);
		if (sanitized) {
			return sanitized;
		}
	}

	return undefined;
}

function hasStructuredType(object: JsonLdObject, typeName: string) {
	const value = object['@type'];

	if (typeof value === 'string') {
		return value.toLowerCase() === typeName.toLowerCase();
	}

	if (Array.isArray(value)) {
		return value.some((entry) => typeof entry === 'string' && entry.toLowerCase() === typeName.toLowerCase());
	}

	return false;
}

function readVideoMetadata($: ReturnType<typeof load>, pageUrl: string, structuredData: JsonLdObject[]) {
	const videoObjects = structuredData.filter((object) => hasStructuredType(object, 'VideoObject') || hasStructuredType(object, 'Clip'));
	const embedCandidate =
		readMeta($, ['meta[name="twitter:player"]']) ||
		findStructuredUrl(videoObjects, ['embedUrl'], pageUrl) ||
		sanitizeMediaUrl($('iframe[src]').first().attr('src') || '', pageUrl) ||
		'';
	const directCandidate =
		readMeta($, ['meta[property="og:video:secure_url"]', 'meta[property="og:video:url"]', 'meta[property="og:video"]']) ||
		findStructuredUrl(videoObjects, ['contentUrl', 'url'], pageUrl) ||
		sanitizeMediaUrl($('video').first().attr('src') || $('video source').first().attr('src') || '', pageUrl) ||
		'';

	const embedUrl = sanitizeMediaUrl(embedCandidate, pageUrl);
	const videoUrl = sanitizeMediaUrl(directCandidate, pageUrl);

	return {
		videoEmbedUrl: embedUrl && embedUrl !== pageUrl ? embedUrl : undefined,
		videoUrl: videoUrl && videoUrl !== pageUrl && videoUrl !== embedUrl ? videoUrl : undefined,
	};
}

function readPublishedAt($: ReturnType<typeof load>, structuredData: JsonLdObject[]) {
	return toIsoDate(
		readMeta($, [
			'meta[property="article:published_time"]',
			'meta[property="og:published_time"]',
			'meta[property="article:modified_time"]',
			'meta[property="og:updated_time"]',
			'meta[name="date"]',
			'meta[name="dc.date"]',
			'time[datetime]',
		]) || findStructuredText(structuredData, ['datePublished', 'dateModified', 'dateCreated']),
	);
}

function readBodyText($: ReturnType<typeof load>, structuredData: JsonLdObject[]) {
	const workingRoot = load($.html());
	workingRoot(NOISE_SELECTORS.join(',')).remove();
	const structuredBodyText = truncate(findStructuredText(structuredData, ['articleBody', 'text']), MAX_TEXT_LENGTH);

	function trimTail(text: string) {
		let trimmed = text;

		for (const marker of ARTICLE_TAIL_MARKERS) {
			const matchIndex = trimmed.search(marker);
			if (matchIndex > 500) {
				trimmed = trimmed.slice(0, matchIndex).trim();
			}
		}

		return trimmed;
	}

	if (structuredBodyText.length >= MIN_BODY_CHARS) {
		return trimTail(structuredBodyText);
	}

	const preferredSections = [
		'.content-body',
		'.article-container .content-body',
		'.seamless-article .content-body',
		'.article-container',
		'.seamless-article',
		'article [itemprop="articleBody"]',
		'article',
		'main article',
		'main',
		'[role="main"]',
		'.post-content',
		'.entry-content',
		'.article-body',
		'.story-body',
		'body',
	];

	for (const selector of preferredSections) {
		const text = truncate(stripHtml(workingRoot(selector).first().text()), MAX_TEXT_LENGTH);

		if (text.length >= MIN_BODY_CHARS) {
			return trimTail(text);
		}
	}

	return trimTail(truncate(stripHtml(workingRoot('body').text()) || structuredBodyText, MAX_TEXT_LENGTH));
}

function scoreTextMatch(text: string, tokens: string[], weight: number) {
	const haystack = text.toLowerCase();
	let score = 0;

	for (const token of tokens) {
		if (haystack.includes(token)) {
			score += weight;
		}
	}

	return score;
}

function scorePage(pageUrl: string, title: string, summary: string, text: string, publishedAt: string, tokens: string[], articleLike: boolean) {
	const url = new URL(pageUrl);
	let score = 0;

	score += scoreTextMatch(title, tokens, 8);
	score += scoreTextMatch(summary, tokens, 4);
	score += scoreTextMatch(text.slice(0, 4000), tokens, 1);
	score += scoreTextMatch(pageUrl, tokens, 3);

	if (articleLike) {
		score += 4;
	}

	if (publishedAt && Math.abs(Date.now() - new Date(publishedAt).getTime()) < 14 * 24 * 60 * 60_000) {
		score += 2;
	}

	if (summary.length >= 100) {
		score += 1;
	}

	if (text.length >= 1400) {
		score += 2;
	} else if (text.length < MIN_BODY_CHARS) {
		score -= 4;
	}

	if (title.length < 25) {
		score -= 2;
	}

	if (url.pathname === '/' || url.pathname === '') {
		score -= 5;
	}

	if (shouldSkipUrl(pageUrl)) {
		score -= 8;
	}

	return score;
}

function extractLinks($: ReturnType<typeof load>, pageUrl: string, sameDomainOnly: boolean, structuredUrls: string[] = []) {
	const baseHost = normalizeHost(new URL(pageUrl).hostname);
	const allowOffsiteLinks = !sameDomainOnly || canFollowOffsiteLinks(pageUrl);
	const links: string[] = [];

	$('article a[href], main a[href], a[href]').each((_, element) => {
		if (links.length >= MAX_LINKS_PER_PAGE) {
			return false;
		}

		const href = $(element).attr('href');
		if (!href) {
			return;
		}

		const nextUrl = toAbsoluteUrl(href, pageUrl);
		if (!nextUrl || links.includes(nextUrl) || shouldSkipUrl(nextUrl)) {
			return;
		}

		if (!allowOffsiteLinks && normalizeHost(new URL(nextUrl).hostname) !== baseHost) {
			return;
		}

		links.push(nextUrl);
	});

	for (const candidateUrl of structuredUrls) {
		if (links.length >= MAX_LINKS_PER_PAGE) {
			break;
		}

		if (candidateUrl === pageUrl || links.includes(candidateUrl) || shouldSkipUrl(candidateUrl)) {
			continue;
		}

		if (!allowOffsiteLinks && normalizeHost(new URL(candidateUrl).hostname) !== baseHost) {
			continue;
		}

		links.push(candidateUrl);
	}

	return links;
}

function extractPage(
	html: string,
	pageUrl: string,
	source: FeedSourceConfig,
	tokens: string[],
	discoverySource?: FeedItem['discoverySource'],
	options: { ignoreGenericTextPatterns?: boolean; skipRejectionChecks?: boolean } = {},
): ExtractedPage | null {
	const $ = load(html);
	const structuredData = parseJsonLdBlocks($);
	const canonicalUrl = readCanonicalUrl($, pageUrl, structuredData);
	const structuredUrls = extractStructuredUrls(structuredData, canonicalUrl);

	if (isSearchDiscoveryUrl(canonicalUrl)) {
		const aiSnippet = extractAiSearchSnippet($, canonicalUrl);
		if (aiSnippet) {
			const snippetTitle = `AI Summary: ${source.query ?? 'Search Results'}`;
			const snippetSummary = truncate(aiSnippet, 220);
			const snippetText = truncate(aiSnippet, MAX_TEXT_LENGTH);

			return {
				title: snippetTitle,
				url: canonicalUrl,
				summary: snippetSummary,
				publishedAt: new Date().toISOString(),
				imageUrl: undefined,
				text: snippetText,
				links: [],
				fallbackLinks: [],
				score: 15,
				articleLike: true,
				discoverySource,
			};
		}

		return null;
	}

	const title = readTitle($, structuredData);
	const summary = readSummary($, structuredData);
	const text = readBodyText($, structuredData);
	const articleLike = Boolean($('article').length || $('[itemprop="articleBody"]').length || $('meta[property="article:published_time"]').length || $('time[datetime]').length);

	if (!title || !text) {
		return null;
	}

	const publishedAt = readPublishedAt($, structuredData);
	if (!options.skipRejectionChecks && shouldRejectPage(canonicalUrl, title, summary, text, publishedAt, options)) {
		return null;
	}

	const score = scorePage(canonicalUrl, title, summary, text, publishedAt, tokens, articleLike);

	return {
		title,
		url: canonicalUrl,
		summary,
		publishedAt,
		imageUrl: readImageUrl($, canonicalUrl, structuredData),
		...readVideoMetadata($, canonicalUrl, structuredData),
		text,
		links: extractLinks($, canonicalUrl, source.sameDomainOnly ?? true, structuredUrls),
		fallbackLinks: extractFallbackLinks($, canonicalUrl, tokens, structuredUrls),
		score,
		articleLike,
		discoverySource,
	};
}

function toFeedItem(page: ExtractedPage, source: FeedSourceConfig): FeedItem {
	const dedupeKey = buildDedupeKey(page.title, page.url);

	return {
		id: dedupeKey,
		dedupeKey,
		title: page.title,
		url: page.url,
		summary: page.summary,
		content: page.text,
		sourceId: source.id,
		sourceName: source.title,
		sourceKind: source.kind,
		publishedAt: toIsoDate(page.publishedAt),
		imageUrl: page.imageUrl,
		videoUrl: page.videoUrl,
		videoEmbedUrl: page.videoEmbedUrl,
		tags: [...new Set(source.tags)],
		originFeedUrl: source.feedUrl,
		discoverySource: page.discoverySource,
	};
}

function normalizeFallbackTitle(candidateUrl: string) {
	try {
		const url = new URL(candidateUrl);
		const lastSegment = url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname;
		return (
			stripHtml(
				lastSegment
					.replace(/[-_]+/g, ' ')
					.replace(/\.pdf$/i, '')
					.trim(),
			) || url.hostname
		);
	} catch {
		return candidateUrl;
	}
}

async function fetchPdfFallback(candidateUrl: string, source: FeedSourceConfig, tokens: string[], discoverySource?: FeedItem['discoverySource'], publishedAt?: string) {
	try {
		const response = await fetch(candidateUrl, {
			headers: buildHeaders(source),
			next: { revalidate: 0 },
			redirect: 'follow',
		});

		if (!response.ok) {
			return null;
		}

		const finalUrl = response.url || candidateUrl;
		const pdfParseModule = (await import('pdf-parse')) as unknown as {
			PDFParse: new (options: { data: Uint8Array }) => {
				getText: () => Promise<{ text: string }>;
				getInfo: () => Promise<{ info?: { Title?: string } }>;
				destroy: () => Promise<void>;
			};
		};
		const pdfBuffer = Buffer.from(await response.arrayBuffer());
		const parser = new pdfParseModule.PDFParse({ data: new Uint8Array(pdfBuffer) });
		const [parsedText, parsedInfo] = await Promise.all([parser.getText(), parser.getInfo()]);
		await parser.destroy();
		const text = truncate(stripHtml(parsedText.text ?? ''), MAX_TEXT_LENGTH);

		if (text.length < THIN_PAGE_TEXT_CHARS) {
			return null;
		}

		const title = stripHtml(parsedInfo.info?.Title ?? normalizeFallbackTitle(finalUrl));
		const summary = summarizeText(text);
		const resolvedPublishedAt = publishedAt ?? '';

		if (shouldRejectPage(finalUrl, title, summary, text, resolvedPublishedAt)) {
			return null;
		}

		return {
			title,
			url: finalUrl,
			summary,
			publishedAt: resolvedPublishedAt,
			imageUrl: undefined,
			videoUrl: undefined,
			videoEmbedUrl: undefined,
			text,
			links: [],
			fallbackLinks: [],
			score: scorePage(finalUrl, title, summary, text, resolvedPublishedAt, tokens, true),
			articleLike: true,
			discoverySource,
		} satisfies ExtractedPage;
	} catch {
		return null;
	}
}

async function fetchFallbackCandidatesFromPage(pageUrl: string, source: FeedSourceConfig, tokens: string[]) {
	try {
		const response = await fetch(pageUrl, {
			headers: buildHeaders(source),
			next: { revalidate: 0 },
			redirect: 'follow',
		});

		if (!response.ok) {
			return [];
		}

		const contentType = response.headers.get('content-type') ?? '';
		if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
			return [];
		}

		const html = await response.text();
		const finalUrl = response.url || pageUrl;
		const $ = load(html);
		return extractFallbackLinks($, finalUrl, tokens, extractStructuredUrls(parseJsonLdBlocks($), finalUrl));
	} catch {
		return [];
	}
}

async function collectSeedFallbackMatches(source: FeedSourceConfig, tokens: string[], existingUrls: Set<string>) {
	const matches: ExtractedPage[] = [];

	for (const seedUrl of source.seedUrls?.filter(Boolean) ?? []) {
		const discoverySource = classifyDiscoverySource(seedUrl);
		const candidateUrls = await fetchFallbackCandidatesFromPage(seedUrl, source, tokens);

		for (const candidateUrl of candidateUrls.slice(0, MAX_SEED_FALLBACK_CANDIDATES)) {
			if (existingUrls.has(candidateUrl) || isSearchDiscoveryUrl(candidateUrl)) {
				continue;
			}

			existingUrls.add(candidateUrl);
			const extracted = await fetchFallbackPage(candidateUrl, source, tokens, discoverySource);
			if (!extracted) {
				continue;
			}

			const enrichedPage = await enrichThinPage(extracted, source, tokens);
			if (enrichedPage.score >= 3 && (enrichedPage.articleLike || enrichedPage.text.length >= 500)) {
				matches.push(enrichedPage);
			}

			if (matches.length >= source.maxItems) {
				return matches;
			}
		}
	}

	return matches;
}

function extractSeedSnippetMatches(html: string, pageUrl: string, tokens: string[], discoverySource?: FeedItem['discoverySource']) {
	const $ = load(html);
	const pageHost = normalizeHost(new URL(pageUrl).hostname);
	const matches = new Map<string, ExtractedPage>();

	$('a[href]').each((_, element) => {
		const href = $(element).attr('href');
		if (!href) {
			return;
		}

		const candidateUrl = toAbsoluteUrl(href, pageUrl);
		if (!candidateUrl || isSearchDiscoveryUrl(candidateUrl) || shouldSkipFallbackUrl(candidateUrl)) {
			return;
		}

		const candidateHost = normalizeHost(new URL(candidateUrl).hostname);
		if (candidateHost === pageHost) {
			return;
		}

		const visibleTitle = stripHtml($(element).text());
		const title = truncate(visibleTitle || normalizeFallbackTitle(candidateUrl), 180);
		if (title.length < 16) {
			return;
		}

		const containerText = truncate(stripHtml($(element).parent().text() || $(element).closest('article, li, div').first().text()), 900);
		const summary = truncate(containerText || title, 220);
		const text = truncate(containerText || `${title}. ${summary}`, THIN_PAGE_TEXT_CHARS);
		const relevanceScore = scoreTextMatch(`${title} ${summary} ${candidateUrl}`, tokens, 1);

		if (!summary || relevanceScore <= 0 || shouldRejectDiscoverySnippet(candidateUrl, title, summary)) {
			return;
		}

		const score = Math.max(4, scorePage(candidateUrl, title, summary, text, '', tokens, true));
		const existing = matches.get(candidateUrl);
		if (!existing || score > existing.score) {
			matches.set(candidateUrl, {
				title,
				url: candidateUrl,
				summary,
				publishedAt: '',
				imageUrl: undefined,
				videoUrl: undefined,
				videoEmbedUrl: undefined,
				text,
				links: [],
				fallbackLinks: [],
				score,
				articleLike: true,
				discoverySource,
			});
		}
	});

	return [...matches.values()].sort((left, right) => right.score - left.score).slice(0, MAX_SEED_FALLBACK_CANDIDATES);
}

async function collectSeedSnippetFallbackMatches(source: FeedSourceConfig, tokens: string[], existingUrls: Set<string>) {
	const matches: ExtractedPage[] = [];

	for (const seedUrl of source.seedUrls?.filter(Boolean) ?? []) {
		try {
			const response = await fetch(seedUrl, {
				headers: buildHeaders(source),
				next: { revalidate: 0 },
				redirect: 'follow',
			});

			if (!response.ok) {
				continue;
			}

			const contentType = response.headers.get('content-type') ?? '';
			if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
				continue;
			}

			const finalUrl = response.url || seedUrl;
			const html = await response.text();
			const seedMatches = extractSeedSnippetMatches(html, finalUrl, tokens, classifyDiscoverySource(finalUrl));

			for (const match of seedMatches) {
				if (existingUrls.has(match.url)) {
					continue;
				}

				existingUrls.add(match.url);
				matches.push(match);

				if (matches.length >= source.maxItems) {
					return matches;
				}
			}
		} catch {
			continue;
		}
	}

	return matches;
}

async function fetchFallbackPage(candidateUrl: string, source: FeedSourceConfig, tokens: string[], discoverySource?: FeedItem['discoverySource'], publishedAt?: string) {
	if (isPdfUrl(candidateUrl)) {
		return await fetchPdfFallback(candidateUrl, source, tokens, discoverySource, publishedAt);
	}

	try {
		const response = await fetch(candidateUrl, {
			headers: buildHeaders(source),
			next: { revalidate: 0 },
			redirect: 'follow',
		});

		if (!response.ok) {
			return null;
		}

		const contentType = response.headers.get('content-type') ?? '';
		if (contentType.includes('application/pdf')) {
			return await fetchPdfFallback(response.url || candidateUrl, source, tokens, discoverySource, publishedAt);
		}

		if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
			return null;
		}

		const html = await response.text();
		const finalUrl = response.url || candidateUrl;
		const extracted =
			extractPage(html, finalUrl, source, tokens, discoverySource) ||
			extractPage(html, finalUrl, source, tokens, discoverySource, { ignoreGenericTextPatterns: true }) ||
			extractPage(html, finalUrl, source, tokens, discoverySource, { ignoreGenericTextPatterns: true, skipRejectionChecks: true });
		if (!extracted) {
			return null;
		}

		if (!extracted.publishedAt && publishedAt) {
			extracted.publishedAt = publishedAt;
		}

		return extracted;
	} catch {
		return null;
	}
}

async function enrichThinPage(page: ExtractedPage, source: FeedSourceConfig, tokens: string[]) {
	if (page.text.length >= THIN_PAGE_TEXT_CHARS && page.summary.length >= 80) {
		return page;
	}

	const fallbackLinks = page.fallbackLinks.length > 0 ? page.fallbackLinks : await fetchFallbackCandidatesFromPage(page.url, source, tokens);

	for (const candidateUrl of fallbackLinks.slice(0, MAX_ENRICHMENT_LINKS)) {
		const enrichedPage = await fetchFallbackPage(candidateUrl, source, tokens, page.discoverySource, page.publishedAt);
		if (!enrichedPage) {
			continue;
		}

		if (enrichedPage.text.length <= page.text.length + 250) {
			continue;
		}

		return {
			...enrichedPage,
			title: enrichedPage.title.length >= 20 ? enrichedPage.title : page.title,
			discoverySource: page.discoverySource ?? enrichedPage.discoverySource,
		};
	}

	return page;
}

function summarizeText(text: string) {
	const normalized = stripHtml(text);
	if (!normalized) {
		return '';
	}

	const firstSentence = normalized.match(/(.+?[.!?])(?:\s|$)/)?.[1] ?? normalized;
	return truncate(firstSentence, 220);
}

function limitPagesPerDomain(pages: ExtractedPage[], maxItemsPerDomain: number) {
	const domainCounts = new Map<string, number>();
	const limited: ExtractedPage[] = [];

	for (const page of pages) {
		const domain = normalizeHost(new URL(page.url).hostname);
		const count = domainCounts.get(domain) ?? 0;

		if (count >= maxItemsPerDomain) {
			continue;
		}

		domainCounts.set(domain, count + 1);
		limited.push(page);
	}

	return limited;
}

function scoreScrapyPage(page: ScrapyPage, source: FeedSourceConfig, tokens: string[]) {
	return scorePage(page.url, page.title, summarizeText(page.text), page.text, '', tokens, page.text.length >= 600);
}

function mapScrapyPage(page: ScrapyPage, source: FeedSourceConfig, tokens: string[], discoverySource?: FeedItem['discoverySource']): ExtractedPage | null {
	const title = stripHtml(page.title);
	const text = truncate(stripHtml(page.text), MAX_TEXT_LENGTH);
	const summary = summarizeText(text);

	if (!title || !text) {
		return null;
	}

	if (shouldRejectPage(page.url, title, summary, text, '')) {
		return null;
	}

	return {
		title,
		url: page.url,
		summary,
		publishedAt: '',
		imageUrl: undefined,
		videoUrl: undefined,
		videoEmbedUrl: undefined,
		text,
		links: page.links,
		fallbackLinks: page.links,
		score: scoreScrapyPage(page, source, tokens),
		articleLike: text.length >= 600,
		discoverySource,
	};
}

async function crawlWithScrapy(source: FeedSourceConfig, tokens: string[]) {
	const seedUrls = source.seedUrls?.filter(Boolean) ?? [];
	const maxPages = Math.max(1, Math.min(source.crawlMaxPages ?? DEFAULT_MAX_PAGES, 100));
	const crawlDepth = Math.max(0, Math.min(source.crawlDepth ?? DEFAULT_CRAWL_DEPTH, 5));
	const matches: ExtractedPage[] = [];

	for (const seedUrl of seedUrls) {
		const discoverySource = classifyDiscoverySource(seedUrl);
		const pagesPerSeed =
			discoverySource ? Math.max(SEARCH_DISCOVERY_MIN_PAGES, Math.ceil(maxPages / Math.max(seedUrls.length, 1))) : Math.max(3, Math.ceil(maxPages / Math.max(seedUrls.length, 1)));
		const result = await runScrapyCrawler({
			url: seedUrl,
			maxPages: pagesPerSeed,
			maxDepth: crawlDepth,
			allowOffsite: !(source.sameDomainOnly ?? true) || canFollowOffsiteLinks(seedUrl),
		});

		for (const page of result.pages) {
			const mapped = mapScrapyPage(page, source, tokens, discoverySource);
			if (!mapped) {
				continue;
			}

			const enrichedPage = await enrichThinPage(mapped, source, tokens);

			if (enrichedPage.score >= 4 && (enrichedPage.articleLike || enrichedPage.text.length >= 600)) {
				matches.push(enrichedPage);
			}
		}
	}

	return matches.slice(0, maxPages);
}

async function crawlWithCheerio(source: FeedSourceConfig, tokens: string[]) {
	const seedUrls = source.seedUrls?.filter(Boolean) ?? [];
	const visited = new Set<string>();
	const queue: CrawlQueueItem[] = seedUrls.map((url) => ({
		url,
		depth: 0,
		discoverySource: classifyDiscoverySource(url),
	}));
	const matches: ExtractedPage[] = [];
	const maxPages = Math.max(1, Math.min(source.crawlMaxPages ?? DEFAULT_MAX_PAGES, 100));
	const crawlDepth = Math.max(0, Math.min(source.crawlDepth ?? DEFAULT_CRAWL_DEPTH, 5));
	let crawledCount = 0;

	while (queue.length > 0 && crawledCount < maxPages) {
		const current = queue.shift();
		if (!current || visited.has(current.url)) {
			continue;
		}

		visited.add(current.url);

		try {
			const response = await fetch(current.url, {
				headers: buildHeaders(source),
				next: { revalidate: 0 },
				redirect: 'follow',
			});

			if (!response.ok) {
				continue;
			}

			const contentType = response.headers.get('content-type') ?? '';
			if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
				continue;
			}

			const html = await response.text();
			const finalUrl = response.url || current.url;
			const discoveryLinks = isSearchDiscoveryUrl(finalUrl) ? extractLinks(load(html), finalUrl, source.sameDomainOnly ?? true) : [];
			const page = extractPage(html, finalUrl, source, tokens, current.discoverySource ?? classifyDiscoverySource(finalUrl));
			crawledCount += 1;

			if (!page) {
				if (current.depth < crawlDepth) {
					for (const nextUrl of discoveryLinks) {
						if (!visited.has(nextUrl)) {
							queue.push({
								url: nextUrl,
								depth: current.depth + 1,
								discoverySource: current.discoverySource ?? classifyDiscoverySource(nextUrl),
							});
						}
					}
				}
				continue;
			}

			const enrichedPage = await enrichThinPage(page, source, tokens);

			if (enrichedPage.score >= 4 && (enrichedPage.articleLike || enrichedPage.text.length >= 600)) {
				matches.push(enrichedPage);
			}

			if (current.depth < crawlDepth) {
				for (const nextUrl of enrichedPage.links) {
					if (!visited.has(nextUrl)) {
						queue.push({
							url: nextUrl,
							depth: current.depth + 1,
							discoverySource: current.discoverySource ?? classifyDiscoverySource(nextUrl),
						});
					}
				}
			}
		} catch {
			continue;
		}
	}

	return matches;
}

export async function fetchWebCrawlSource(source: FeedSourceConfig): Promise<FeedSourceResult> {
	if (source.kind !== 'web-crawl') {
		throw new Error(`Source ${source.id} is not a web crawl source.`);
	}

	const seedUrls = source.seedUrls?.filter(Boolean) ?? [];
	if (seedUrls.length === 0) {
		throw new Error(`Web crawl source ${source.id} requires at least one seed URL.`);
	}

	const tokens = tokenizeSource(source);
	const preferredEngine = source.crawlEngine ?? 'cheerio';
	let matches = preferredEngine === 'scrapy' ? await crawlWithScrapy(source, tokens).catch(() => crawlWithCheerio(source, tokens)) : await crawlWithCheerio(source, tokens);

	if (matches.length < Math.min(MIN_FALLBACK_MATCHES, source.maxItems)) {
		const fallbackMatches = await collectSeedFallbackMatches(source, tokens, new Set(matches.map((page) => page.url)));
		matches = [...matches, ...fallbackMatches];
	}

	if (matches.length < Math.min(DESIRED_MIN_MATCHES, source.maxItems)) {
		const snippetFallbackMatches = await collectSeedSnippetFallbackMatches(source, tokens, new Set(matches.map((page) => page.url)));
		matches = [...matches, ...snippetFallbackMatches];
	}

	const rankedMatches = matches.sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}

		return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
	});
	const balancedMatches = limitPagesPerDomain(rankedMatches, DEFAULT_MAX_ITEMS_PER_DOMAIN);

	const fetchedAt = new Date().toISOString();
	const staleAt = new Date(Date.now() + source.pollMinutes * 60_000).toISOString();
	const items = dedupeAndSortFeedItems(balancedMatches.map((page) => toFeedItem(page, source))).slice(0, source.maxItems);

	return {
		source,
		items,
		fetchedAt,
		staleAt,
	};
}
