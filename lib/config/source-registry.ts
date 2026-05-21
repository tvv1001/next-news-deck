import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { defaultFeedColumns, defaultFeedSources } from '@/lib/config/default-columns';
import { FeedSourceConfig, FeedSourceRegistryDocument, FeedSourceWithMeta } from '@/lib/feeds/types';

const REGISTRY_FILE_PATH = path.join(process.cwd(), 'data', 'feed-source-overrides.json');
const REGISTRY_VERSION = 1 as const;
const VALID_SOURCE_KINDS = new Set<FeedSourceConfig['kind']>(['rss', 'reddit', 'web-crawl']);
const VALID_CRAWL_ENGINES = new Set<NonNullable<FeedSourceConfig['crawlEngine']>>(['cheerio', 'scrapy']);
const BUILT_IN_SOURCE_IDS = new Set(defaultFeedSources.map((source) => source.id));

function createEmptyRegistry(): FeedSourceRegistryDocument {
	return {
		version: REGISTRY_VERSION,
		upserts: [],
		deletedIds: [],
	};
}

function sanitizeString(value: string | undefined, label: string) {
	const normalized = value?.trim() ?? '';
	if (!normalized) {
		throw new Error(`${label} is required.`);
	}

	return normalized;
}

function sanitizeUrl(value: string | undefined, label: string) {
	const normalized = sanitizeString(value, label);
	let parsed: URL;

	try {
		parsed = new URL(normalized);
	} catch {
		throw new Error(`${label} must be a valid absolute URL.`);
	}

	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw new Error(`${label} must use http or https.`);
	}

	return parsed.toString();
}

function sanitizeNumeric(value: number | undefined, label: string, min: number, max: number, fallback?: number) {
	const candidate = value ?? fallback;
	if (candidate === undefined || !Number.isFinite(candidate)) {
		throw new Error(`${label} must be a number.`);
	}

	const normalized = Math.round(candidate);
	if (normalized < min || normalized > max) {
		throw new Error(`${label} must be between ${min} and ${max}.`);
	}

	return normalized;
}

function sanitizeTags(tags: string[] | undefined) {
	const normalized =
		tags
			?.flatMap((tag) => tag.split(','))
			.map((tag) => tag.trim())
			.filter(Boolean)
			.map((tag) => tag.toLowerCase()) ?? [];
	const uniqueTags = [...new Set(normalized)];

	if (uniqueTags.length === 0) {
		throw new Error('At least one tag is required.');
	}

	return uniqueTags;
}

function sanitizeSeedUrls(seedUrls: string[] | undefined) {
	return [...new Set((seedUrls ?? []).map((seedUrl) => sanitizeUrl(seedUrl, 'Seed URL')))];
}

export function sanitizeFeedSourceConfig(source: FeedSourceConfig): FeedSourceConfig {
	const id = sanitizeString(source.id, 'Source ID').toLowerCase();
	if (!/^[a-z0-9-]{2,80}$/.test(id)) {
		throw new Error('Source ID must use only lowercase letters, numbers, and dashes.');
	}

	if (!VALID_SOURCE_KINDS.has(source.kind)) {
		throw new Error('Source kind must be rss, reddit, or web-crawl.');
	}

	const normalized: FeedSourceConfig = {
		id,
		kind: source.kind,
		title: sanitizeString(source.title, 'Title'),
		description: sanitizeString(source.description, 'Description'),
		siteUrl: sanitizeUrl(source.siteUrl, 'Site URL'),
		feedUrl: sanitizeUrl(source.feedUrl, 'Feed URL'),
		pollMinutes: sanitizeNumeric(source.pollMinutes, 'Poll minutes', 1, 720, 10),
		maxItems: sanitizeNumeric(source.maxItems, 'Max items', 1, 100, 18),
		tags: sanitizeTags(source.tags),
		userAgent: source.userAgent?.trim() || undefined,
	};

	if (source.kind === 'web-crawl') {
		normalized.query = source.query?.trim() || undefined;
		normalized.seedUrls = sanitizeSeedUrls(source.seedUrls);
		normalized.crawlDepth = sanitizeNumeric(source.crawlDepth, 'Crawl depth', 1, 8, 2);
		normalized.crawlMaxPages = sanitizeNumeric(source.crawlMaxPages, 'Crawl max pages', 1, 200, 18);
		normalized.sameDomainOnly = Boolean(source.sameDomainOnly);
		normalized.crawlEngine = source.crawlEngine && VALID_CRAWL_ENGINES.has(source.crawlEngine) ? source.crawlEngine : 'scrapy';
	}

	if (source.kind !== 'web-crawl') {
		normalized.query = source.query?.trim() || undefined;
	}

	return normalized;
}

async function ensureRegistryFile() {
	await mkdir(path.dirname(REGISTRY_FILE_PATH), { recursive: true });

	try {
		await readFile(REGISTRY_FILE_PATH, 'utf8');
	} catch {
		await writeFile(REGISTRY_FILE_PATH, `${JSON.stringify(createEmptyRegistry(), null, 2)}\n`, 'utf8');
	}
}

async function readRegistryDocument() {
	await ensureRegistryFile();
	const rawDocument = await readFile(REGISTRY_FILE_PATH, 'utf8');
	const parsed = JSON.parse(rawDocument) as Partial<FeedSourceRegistryDocument>;

	return {
		version: REGISTRY_VERSION,
		upserts: Array.isArray(parsed.upserts) ? parsed.upserts.map(sanitizeFeedSourceConfig) : [],
		deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds.map((sourceId) => String(sourceId).trim().toLowerCase()).filter(Boolean) : [],
	} satisfies FeedSourceRegistryDocument;
}

async function writeRegistryDocument(document: FeedSourceRegistryDocument) {
	await ensureRegistryFile();
	await writeFile(REGISTRY_FILE_PATH, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

export async function getConfiguredFeedSources() {
	const document = await readRegistryDocument();
	const deletedIds = new Set(document.deletedIds);
	const sourceMap = new Map<string, FeedSourceConfig>();

	for (const source of defaultFeedSources) {
		if (!deletedIds.has(source.id)) {
			sourceMap.set(source.id, source);
		}
	}

	for (const source of document.upserts) {
		sourceMap.set(source.id, source);
	}

	return [...sourceMap.values()];
}

export async function getConfiguredFeedSource(sourceId: string) {
	const normalizedId = sourceId.trim().toLowerCase();
	const sources = await getConfiguredFeedSources();
	return sources.find((source) => source.id === normalizedId);
}

export async function getConfiguredFeedSourceMap() {
	return new Map((await getConfiguredFeedSources()).map((source) => [source.id, source]));
}

export async function getConfiguredSourcesWithMeta(): Promise<FeedSourceWithMeta[]> {
	const configuredSources = await getConfiguredFeedSources();

	return configuredSources.map((source) => ({
		...source,
		builtIn: BUILT_IN_SOURCE_IDS.has(source.id),
		attachedColumnIds: defaultFeedColumns.filter((column) => column.sourceIds.includes(source.id)).map((column) => column.id),
	}));
}

export async function upsertConfiguredFeedSource(source: FeedSourceConfig) {
	const normalizedSource = sanitizeFeedSourceConfig(source);
	const document = await readRegistryDocument();
	const isBuiltIn = BUILT_IN_SOURCE_IDS.has(normalizedSource.id);
	const nextUpserts = document.upserts.filter((entry) => entry.id !== normalizedSource.id);

	nextUpserts.push(normalizedSource);

	const nextDocument: FeedSourceRegistryDocument = {
		version: REGISTRY_VERSION,
		upserts: nextUpserts,
		deletedIds: isBuiltIn ? document.deletedIds.filter((sourceId) => sourceId !== normalizedSource.id) : document.deletedIds,
	};

	await writeRegistryDocument(nextDocument);
	return normalizedSource;
}

export async function deleteConfiguredFeedSource(sourceId: string) {
	const normalizedId = sourceId.trim().toLowerCase();
	if (!normalizedId) {
		throw new Error('Source ID is required.');
	}

	const document = await readRegistryDocument();
	const isBuiltIn = BUILT_IN_SOURCE_IDS.has(normalizedId);
	const sourceExists = (await getConfiguredFeedSources()).some((source) => source.id === normalizedId);
	if (!sourceExists) {
		throw new Error(`Source ${normalizedId} was not found.`);
	}

	const nextDocument: FeedSourceRegistryDocument = {
		version: REGISTRY_VERSION,
		upserts: document.upserts.filter((source) => source.id !== normalizedId),
		deletedIds: isBuiltIn ? [...new Set([...document.deletedIds, normalizedId])] : document.deletedIds.filter((sourceId) => sourceId !== normalizedId),
	};

	await writeRegistryDocument(nextDocument);
}
