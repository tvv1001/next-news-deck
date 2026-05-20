/**
 * Export all feed sources as OPML (Outline Processor Markup Language).
 * OPML is a standard format for sharing feed subscriptions between readers.
 *
 * Usage: GET /api/feeds/export/opml
 * Save the output and import into Feedly, Apple News, Inoreader, etc.
 */

import { NextRequest, NextResponse } from 'next/server';

import { defaultFeedSources } from '@/lib/config/default-columns';
import { generateOpmlXml } from '@/lib/feeds/rss-generator';

export async function GET(req: NextRequest): Promise<NextResponse> {
	try {
		// Generate OPML from all feed sources
		const opmlXml = generateOpmlXml(
			defaultFeedSources.map((source) => ({
				id: source.id,
				title: source.title,
				feedUrl: source.feedUrl,
				siteUrl: source.siteUrl,
				tags: source.tags,
			})),
			'Next News Deck - Feed Subscriptions',
		);

		// Return as OPML XML
		return new NextResponse(opmlXml, {
			status: 200,
			headers: {
				'Content-Type': 'application/rss+xml; charset=utf-8',
				'Content-Disposition': 'attachment; filename="news-deck-subscriptions.opml"',
				'Cache-Control': 'max-age=3600, public', // Cache for 1 hour
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to generate OPML export';

		console.error('OPML export error:', message);

		return NextResponse.json({ error: message }, { status: 500 });
	}
}
