import { load } from 'cheerio';

import { runScrapyCrawler, ScrapyPage } from '@/lib/crawler/scrapy-runner';
import { buildDedupeKey, dedupeAndSortFeedItems, stripHtml, toIsoDate, truncate } from '@/lib/feeds/normalize';
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
	text: string;
	links: string[];
	score: number;
	articleLike: boolean;
	discoverySource?: FeedItem['discoverySource'];
}

const DEFAULT_MAX_PAGES = 18;
const DEFAULT_CRAWL_DEPTH = 1;
const DEFAULT_MAX_ITEMS_PER_DOMAIN = 3;
const MAX_LINKS_PER_PAGE = 24;
const MAX_TEXT_LENGTH = 12_000;
const MIN_BODY_CHARS = 280;
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

function readMeta($: ReturnType<typeof load>, selectors: string[]) {
	for (const selector of selectors) {
		const value = $(selector).attr('content')?.trim() ?? $(selector).attr('datetime')?.trim() ?? '';

		if (value) {
			return value;
		}
	}

	return '';
}

function readCanonicalUrl($: ReturnType<typeof load>, pageUrl: string) {
	const canonical = $('link[rel="canonical"]').attr('href')?.trim() || readMeta($, ['meta[property="og:url"]']);

	return canonical ? (toAbsoluteUrl(canonical, pageUrl) ?? pageUrl) : pageUrl;
}

function readTitle($: ReturnType<typeof load>) {
	return stripHtml(
		readMeta($, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
			$('article h1').first().text() ||
			$('main h1').first().text() ||
			$('h1').first().text() ||
			$('title').first().text(),
	);
}

function readSummary($: ReturnType<typeof load>) {
	const paragraphs = $('article p, main p, p')
		.toArray()
		.map((element) => stripHtml($(element).text()))
		.filter((value) => value.length > 80);

	return truncate(
		stripHtml(
			readMeta($, ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) ||
				paragraphs[0] ||
				$('article p').slice(0, 3).text() ||
				$('main p').slice(0, 3).text() ||
				$('p').slice(0, 3).text(),
		),
		220,
	);
}

function readImageUrl($: ReturnType<typeof load>, pageUrl: string) {
	const image =
		readMeta($, ['meta[property="og:image"]', 'meta[name="twitter:image"]']) ||
		$('article img').first().attr('src') ||
		$('main img').first().attr('src') ||
		$('img').first().attr('src') ||
		'';

	return image ? (toAbsoluteUrl(image, pageUrl) ?? undefined) : undefined;
}

function readPublishedAt($: ReturnType<typeof load>) {
	return toIsoDate(
		readMeta($, [
			'meta[property="article:published_time"]',
			'meta[property="og:published_time"]',
			'meta[property="article:modified_time"]',
			'meta[property="og:updated_time"]',
			'meta[name="date"]',
			'meta[name="dc.date"]',
			'time[datetime]',
		]),
	);
}

function readBodyText($: ReturnType<typeof load>) {
	const workingRoot = load($.html());
	workingRoot(NOISE_SELECTORS.join(',')).remove();

	const preferredSections = [
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
			return text;
		}
	}

	return truncate(stripHtml(workingRoot('body').text()), MAX_TEXT_LENGTH);
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

function extractLinks($: ReturnType<typeof load>, pageUrl: string, sameDomainOnly: boolean) {
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

	return links;
}

function extractPage(html: string, pageUrl: string, source: FeedSourceConfig, tokens: string[], discoverySource?: FeedItem['discoverySource']): ExtractedPage | null {
	const $ = load(html);
	const canonicalUrl = readCanonicalUrl($, pageUrl);
	const title = readTitle($);
	const summary = readSummary($);
	const text = readBodyText($);
	const articleLike = Boolean($('article').length || $('[itemprop="articleBody"]').length || $('meta[property="article:published_time"]').length || $('time[datetime]').length);

	if (!title || !text) {
		return null;
	}

	const publishedAt = readPublishedAt($);
	const score = scorePage(canonicalUrl, title, summary, text, publishedAt, tokens, articleLike);

	return {
		title,
		url: canonicalUrl,
		summary,
		publishedAt,
		imageUrl: readImageUrl($, canonicalUrl),
		text,
		links: extractLinks($, canonicalUrl, source.sameDomainOnly ?? true),
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
		sourceId: source.id,
		sourceName: source.title,
		sourceKind: source.kind,
		publishedAt: page.publishedAt,
		imageUrl: page.imageUrl,
		tags: [...new Set(source.tags)],
		originFeedUrl: source.feedUrl,
		discoverySource: page.discoverySource,
	};
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

	if (!title || !text) {
		return null;
	}

	return {
		title,
		url: page.url,
		summary: summarizeText(text),
		publishedAt: '',
		text,
		links: page.links,
		score: scoreScrapyPage(page, source, tokens),
		articleLike: text.length >= 600,
		discoverySource,
	};
}

async function crawlWithScrapy(source: FeedSourceConfig, tokens: string[]) {
	const seedUrls = source.seedUrls?.filter(Boolean) ?? [];
	const maxPages = Math.max(1, Math.min(source.crawlMaxPages ?? DEFAULT_MAX_PAGES, 40));
	const crawlDepth = Math.max(0, Math.min(source.crawlDepth ?? DEFAULT_CRAWL_DEPTH, 2));
	const pagesPerSeed = Math.max(1, Math.ceil(maxPages / seedUrls.length));
	const matches: ExtractedPage[] = [];

	for (const seedUrl of seedUrls) {
		const discoverySource = classifyDiscoverySource(seedUrl);
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

			if (mapped.score >= 4 && (mapped.articleLike || mapped.text.length >= 600)) {
				matches.push(mapped);
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
	const maxPages = Math.max(1, Math.min(source.crawlMaxPages ?? DEFAULT_MAX_PAGES, 40));
	const crawlDepth = Math.max(0, Math.min(source.crawlDepth ?? DEFAULT_CRAWL_DEPTH, 2));
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
			const page = extractPage(html, finalUrl, source, tokens, current.discoverySource ?? classifyDiscoverySource(finalUrl));
			crawledCount += 1;

			if (!page) {
				continue;
			}

			if (page.score >= 4 && (page.articleLike || page.text.length >= 600)) {
				matches.push(page);
			}

			if (current.depth < crawlDepth) {
				for (const nextUrl of page.links) {
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

	const tokens = tokenizeQuery(source.query);
	const preferredEngine = source.crawlEngine ?? 'cheerio';
	const matches = preferredEngine === 'scrapy' ? await crawlWithScrapy(source, tokens).catch(() => crawlWithCheerio(source, tokens)) : await crawlWithCheerio(source, tokens);
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
