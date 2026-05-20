import { NextResponse } from 'next/server';

import { isRedisConfigured, getPreferredCacheMode } from '@/lib/cache/redis';
import { defaultFeedColumns, defaultFeedSources } from '@/lib/config/default-columns';

export async function GET() {
	return NextResponse.json({
		status: 'ok',
		cacheMode: getPreferredCacheMode(),
		redisConfigured: isRedisConfigured(),
		sourceCount: defaultFeedSources.length,
		columnCount: defaultFeedColumns.length,
		checkedAt: new Date().toISOString(),
	});
}
