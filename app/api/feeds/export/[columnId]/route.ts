/**
 * Export a dashboard column as an RSS feed.
 * Enables sharing columns with external RSS readers.
 *
 * Usage: GET /api/feeds/export/[columnId].xml
 * Example: /api/feeds/export/technology.xml
 */

import { NextRequest, NextResponse } from 'next/server';

import { buildColumnData, buildSourceDataMap } from '@/lib/feeds/compose';
import { defaultFeedColumns } from '@/lib/config/default-columns';
import { getConfiguredFeedSources } from '@/lib/config/source-registry';
import { FeedSourceData } from '@/lib/feeds/types';
import { generateRssXml } from '@/lib/feeds/rss-generator';
import { getSourceResult } from '@/lib/feeds/source-runtime';

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
		const configuredSources = await getConfiguredFeedSources();
		const columnSources = configuredSources.filter((source) => columnSourceIds.has(source.id));

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
