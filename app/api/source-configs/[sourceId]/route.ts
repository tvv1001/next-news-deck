import { NextRequest, NextResponse } from 'next/server';

import { deleteCachedValue } from '@/lib/cache/feed-cache';
import {
	deleteConfiguredFeedSource,
	getConfiguredFeedSource,
	getConfiguredSourcesWithMeta,
	sanitizeFeedSourceConfig,
	upsertConfiguredFeedSource,
} from '@/lib/config/source-registry';
import { FeedSourceConfig } from '@/lib/feeds/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SourceConfigRequestBody {
	source?: FeedSourceConfig;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
	try {
		const { sourceId } = await params;
		const payload = (await request.json()) as SourceConfigRequestBody;
		if (!payload.source) {
			return NextResponse.json({ error: 'Request body must include a source object.' }, { status: 400 });
		}

		const normalizedSource = sanitizeFeedSourceConfig({ ...payload.source, id: sourceId });
		const storedSource = await upsertConfiguredFeedSource(normalizedSource);
		await deleteCachedValue(`feed-source:${storedSource.id}`);

		return NextResponse.json({
			source: storedSource,
			sources: await getConfiguredSourcesWithMeta(),
		});
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update source configuration.' }, { status: 400 });
	}
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
	try {
		const { sourceId } = await params;
		const existingSource = await getConfiguredFeedSource(sourceId);
		if (!existingSource) {
			return NextResponse.json({ error: `Source ${sourceId} was not found.` }, { status: 404 });
		}

		await deleteConfiguredFeedSource(sourceId);
		await deleteCachedValue(`feed-source:${existingSource.id}`);

		return NextResponse.json({
			deletedSourceId: existingSource.id,
			sources: await getConfiguredSourcesWithMeta(),
		});
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to delete source configuration.' }, { status: 400 });
	}
}
