import { NextResponse } from 'next/server';

import { isRedisConfigured, getPreferredCacheMode } from '@/lib/cache/redis';
import { defaultFeedColumns } from '@/lib/config/default-columns';
import { getConfiguredFeedSources } from '@/lib/config/source-registry';
import { getFeedUpdateSubscriberCount } from '@/lib/feeds/live-updates';

export async function GET() {
	const configuredSources = await getConfiguredFeedSources();

	return NextResponse.json({
		status: 'ok',
		cacheMode: getPreferredCacheMode(),
		liveSubscribers: getFeedUpdateSubscriberCount(),
		redisConfigured: isRedisConfigured(),
		sourceCount: configuredSources.length,
		columnCount: defaultFeedColumns.length,
		checkedAt: new Date().toISOString(),
	});
}
