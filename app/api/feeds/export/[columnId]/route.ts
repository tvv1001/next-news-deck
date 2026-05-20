/**
 * Export a dashboard column as an RSS feed.
 * Enables sharing columns with external RSS readers.
 *
 * Usage: GET /api/feeds/export/[columnId].xml
 * Example: /api/feeds/export/technology.xml
 */

import { NextRequest, NextResponse } from 'next/server';

import { getCachedValue } from '@/lib/cache/feed-cache';
import { buildColumnData, buildSourceDataMap } from '@/lib/feeds/compose';
import { defaultFeedColumns, defaultFeedSources } from '@/lib/config/default-columns';
import { fetchRedditSource } from '@/lib/feeds/reddit';
import { fetchRssSource } from '@/lib/feeds/rss';
import { fetchWebCrawlSource } from '@/lib/feeds/web-crawl';
import { generateRssXml } from '@/lib/feeds/rss-generator';
import { FeedSourceConfig, FeedSourceData, FeedSourceResult } from '@/lib/feeds/types';

async function fetchSourcePayload(source: FeedSourceConfig): Promise<FeedSourceResult> {
	try {
		if (source.kind === 'web-crawl') {
			return await fetchWebCrawlSource(source);
		}

		if (source.kind === 'reddit') {
			return await fetchRedditSource(source);
		}

		return await fetchRssSource(source);
	} catch (error) {
		const fetchedAt = new Date().toISOString();

		return {
			source,
			items: [],
			fetchedAt,
			staleAt: new Date(Date.now() + 2 * 60_000).toISOString(),
			error: {
				sourceId: source.id,
				message: error instanceof Error ? error.message : 'Unexpected feed ingestion error.',
				retryable: true,
			},
		};
	}
}

async function getSourceResult(source: FeedSourceConfig) {
	const cacheKey = `feed-source:${source.id}`;
	const ttlMs = source.pollMinutes * 60_000;
	const isBackgroundCrawl = source.kind === 'web-crawl';

	return getCachedValue(cacheKey, ttlMs, () => fetchSourcePayload(source), {
		staleWhileRevalidateMs: isBackgroundCrawl ? 8 * 60_000 : 0,
		refreshInBackground: isBackgroundCrawl,
	});
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ columnId: string }> }): Promise<NextResponse> {
	try {
		// Get columnId from dynamic route parameter (params is a Promise in Next.js 16)
		const { columnId } = await params;

		if (!columnId) {
			return NextResponse.json({ error: 'Missing columnId parameter' }, { status: 400 });
		}

		// Validate column exists
		const column = defaultFeedColumns.find((c) => c.id === columnId);
		if (!column) {
			return NextResponse.json({ error: `Column not found: ${columnId}` }, { status: 404 });
		}

		// Fetch sources for this column
		const columnSourceIds = new Set(column.sourceIds);
		const columnSources = defaultFeedSources.filter((source) => columnSourceIds.has(source.id));

		// Fetch all source data
		const sourceResults = await Promise.all(columnSources.map(getSourceResult));
		const sources: FeedSourceData[] = sourceResults.map((result) => ({
			...result.value.source,
			items: result.value.items,
			fetchedAt: result.value.fetchedAt,
			staleAt: result.value.staleAt,
			cached: result.cached,
			stale: result.stale,
			errors: result.value.error ? [result.value.error] : [],
		}));

		// Build source map and column data
		const sourceMap = buildSourceDataMap(sources);
		const columnData = buildColumnData(column, sourceMap);

		// Generate RSS feed from items
		const rssXml = generateRssXml(columnData.items, {
			title: `Next News Deck - ${column.title}`,
			description: `${column.description || `News feed for ${column.title}`}`,
			link: 'http://localhost:3000',
			language: 'en-us',
			copyright: '© 2026 Next News Deck',
		});

		// Return as RSS XML
		return new NextResponse(rssXml, {
			status: 200,
			headers: {
				'Content-Type': 'application/rss+xml; charset=utf-8',
				'Content-Disposition': `attachment; filename="${columnId}.xml"`,
				'Cache-Control': 'max-age=300, public', // Cache for 5 minutes
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to generate RSS export';
		const { columnId } = await params;

		console.error(`RSS export error for column ${columnId}:`, message);

		return NextResponse.json({ error: message }, { status: 500 });
	}
}
