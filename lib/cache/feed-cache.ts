import { getPreferredCacheMode, getRedisClient } from '@/lib/cache/redis';
import { CacheMode } from '@/lib/feeds/types';

declare global {
	var __newsDeckMemoryCache: Map<string, { value: string; expiresAt: number }> | undefined;
}

const memoryCache = globalThis.__newsDeckMemoryCache ?? (globalThis.__newsDeckMemoryCache = new Map<string, { value: string; expiresAt: number }>());

export interface CacheResult<T> {
	value: T;
	cached: boolean;
	cacheMode: CacheMode;
}

export async function getCachedValue<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
	const preferredMode = getPreferredCacheMode();
	const redis = getRedisClient();

	if (preferredMode === 'redis' && redis) {
		try {
			const cachedValue = await redis.get(key);

			if (cachedValue) {
				return {
					value: JSON.parse(cachedValue) as T,
					cached: true,
					cacheMode: 'redis',
				};
			}

			const value = await loader();
			await redis.set(key, JSON.stringify(value), 'PX', ttlMs);

			return {
				value,
				cached: false,
				cacheMode: 'redis',
			};
		} catch (error) {
			console.error('Redis cache failed, falling back to memory cache.', error);
		}
	}

	const existingEntry = memoryCache.get(key);
	const now = Date.now();

	if (existingEntry && existingEntry.expiresAt > now) {
		return {
			value: JSON.parse(existingEntry.value) as T,
			cached: true,
			cacheMode: 'memory',
		};
	}

	const value = await loader();
	memoryCache.set(key, {
		value: JSON.stringify(value),
		expiresAt: now + ttlMs,
	});

	return {
		value,
		cached: false,
		cacheMode: 'memory',
	};
}
