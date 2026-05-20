import Redis from 'ioredis';

import { CacheMode } from '@/lib/feeds/types';

declare global {
	var __newsDeckRedisClient: Redis | undefined;
}

export function isRedisConfigured(): boolean {
	return Boolean(process.env.REDIS_URL?.trim());
}

export function getPreferredCacheMode(): CacheMode {
	return isRedisConfigured() ? 'redis' : 'memory';
}

export function getRedisClient(): Redis | null {
	const redisUrl = process.env.REDIS_URL?.trim();

	if (!redisUrl) {
		return null;
	}

	if (!globalThis.__newsDeckRedisClient) {
		globalThis.__newsDeckRedisClient = new Redis(redisUrl, {
			maxRetriesPerRequest: 1,
			enableAutoPipelining: true,
		});
	}

	return globalThis.__newsDeckRedisClient;
}
