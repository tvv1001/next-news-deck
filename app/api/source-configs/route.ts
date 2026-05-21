import { NextRequest, NextResponse } from 'next/server';

import { deleteCachedValue } from '@/lib/cache/feed-cache';
import { defaultFeedColumns } from '@/lib/config/default-columns';
import { getConfiguredSourcesWithMeta, sanitizeFeedSourceConfig, upsertConfiguredFeedSource } from '@/lib/config/source-registry';
import { FeedSourceConfig } from '@/lib/feeds/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SourceConfigRequestBody {
	source?: FeedSourceConfig;
}

export async function GET() {
	const sources = await getConfiguredSourcesWithMeta();

	return NextResponse.json({
		sources,
		columns: defaultFeedColumns,
	});
}

export async function POST(request: NextRequest) {
	try {
		const payload = (await request.json()) as SourceConfigRequestBody;
		if (!payload.source) {
			return NextResponse.json({ error: 'Request body must include a source object.' }, { status: 400 });
		}

		const source = sanitizeFeedSourceConfig(payload.source);
		const storedSource = await upsertConfiguredFeedSource(source);
		await deleteCachedValue(`feed-source:${storedSource.id}`);

		return NextResponse.json({
			source: storedSource,
			sources: await getConfiguredSourcesWithMeta(),
		});
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save source configuration.' }, { status: 400 });
	}
}
