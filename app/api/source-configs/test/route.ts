import { NextRequest, NextResponse } from 'next/server';

import { getConfiguredFeedSource, sanitizeFeedSourceConfig } from '@/lib/config/source-registry';
import { testFeedSource } from '@/lib/feeds/source-runtime';
import { FeedSourceConfig } from '@/lib/feeds/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SourceConfigTestRequestBody {
	source?: FeedSourceConfig;
	sourceId?: string;
}

export async function POST(request: NextRequest) {
	try {
		const payload = (await request.json()) as SourceConfigTestRequestBody;
		let source: FeedSourceConfig | undefined;

		if (payload.source) {
			source = sanitizeFeedSourceConfig(payload.source);
		} else if (payload.sourceId) {
			source = await getConfiguredFeedSource(payload.sourceId);
		}

		if (!source) {
			return NextResponse.json({ error: 'Provide either source or sourceId to test.' }, { status: 400 });
		}

		const result = await testFeedSource(source);
		return NextResponse.json({ result });
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to test source configuration.' }, { status: 400 });
	}
}
