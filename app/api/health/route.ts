import { NextResponse } from 'next/server';

import { isRedisConfigured, getPreferredCacheMode } from '@/lib/cache/redis';
import { defaultFeedColumns, defaultFeedSources } from '@/lib/config/default-columns';
import { getFeedUpdateSubscriberCount } from '@/lib/feeds/live-updates';

export async function GET() {
	return NextResponse.json({
		status: 'ok',
		cacheMode: getPreferredCacheMode(),
		liveSubscribers: getFeedUpdateSubscriberCount(),
		redisConfigured: isRedisConfigured(),
		sourceCount: defaultFeedSources.length,
		columnCount: defaultFeedColumns.length,
		checkedAt: new Date().toISOString(),
	});
}
