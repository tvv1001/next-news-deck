import { getPreferredCacheMode, getRedisClient } from '@/lib/cache/redis';
import { CacheMode } from '@/lib/feeds/types';

declare global {
	var __newsDeckMemoryCache: Map<string, { value: string; freshUntil: number; expiresAt: number }> | undefined;
	var __newsDeckBackgroundRefreshes: Map<string, Promise<void>> | undefined;
}

const memoryCache = globalThis.__newsDeckMemoryCache ?? (globalThis.__newsDeckMemoryCache = new Map<string, { value: string; freshUntil: number; expiresAt: number }>());
const backgroundRefreshes = globalThis.__newsDeckBackgroundRefreshes ?? (globalThis.__newsDeckBackgroundRefreshes = new Map<string, Promise<void>>());

interface CacheEnvelope<T> {
	value: T;
	freshUntil: number;
}

export interface CacheOptions {
	staleWhileRevalidateMs?: number;
	refreshInBackground?: boolean;
}

export interface CacheResult<T> {
	value: T;
	cached: boolean;
	cacheMode: CacheMode;
	stale?: boolean;
	refreshing?: boolean;
}

function serializeEnvelope<T>(value: T, freshUntil: number) {
	return JSON.stringify({ value, freshUntil } satisfies CacheEnvelope<T>);
}

function parseEnvelope<T>(rawValue: string, fallbackFreshUntil: number): CacheEnvelope<T> {
	const parsed = JSON.parse(rawValue) as CacheEnvelope<T> | T;

	if (parsed && typeof parsed === 'object' && 'value' in parsed && 'freshUntil' in parsed && typeof parsed.freshUntil === 'number') {
		return parsed as CacheEnvelope<T>;
	}

	return {
		value: parsed as T,
		freshUntil: fallbackFreshUntil,
	};
}

async function storeCachedValue<T>(key: string, cacheMode: CacheMode, value: T, freshTtlMs: number, staleWhileRevalidateMs: number) {
	const now = Date.now();
	const freshUntil = now + freshTtlMs;
	const envelope = serializeEnvelope(value, freshUntil);
	const totalTtlMs = freshTtlMs + staleWhileRevalidateMs;

	if (cacheMode === 'redis') {
		const redis = getRedisClient();
		if (redis) {
			await redis.set(key, envelope, 'PX', totalTtlMs);
			return;
		}
	}

	memoryCache.set(key, {
		value: envelope,
		freshUntil,
		expiresAt: now + totalTtlMs,
	});
}

function queueBackgroundRefresh<T>(key: string, loader: () => Promise<T>, ttlMs: number, staleWhileRevalidateMs: number, cacheMode: CacheMode) {
	if (backgroundRefreshes.has(key)) {
		return false;
	}

	const refreshPromise = (async () => {
		try {
			const nextValue = await loader();
			await storeCachedValue(key, cacheMode, nextValue, ttlMs, staleWhileRevalidateMs);
		} finally {
			backgroundRefreshes.delete(key);
		}
	})();

	backgroundRefreshes.set(key, refreshPromise);
	return true;
}

export async function getCachedValue<T>(key: string, ttlMs: number, loader: () => Promise<T>, options: CacheOptions = {}): Promise<CacheResult<T>> {
	const preferredMode = getPreferredCacheMode();
	const redis = getRedisClient();
	const staleWhileRevalidateMs = Math.max(0, options.staleWhileRevalidateMs ?? 0);
	const refreshInBackground = Boolean(options.refreshInBackground && staleWhileRevalidateMs > 0);
	const totalTtlMs = ttlMs + staleWhileRevalidateMs;
	const now = Date.now();

	if (preferredMode === 'redis' && redis) {
		try {
			const cachedValue = await redis.get(key);

			if (cachedValue) {
				const envelope = parseEnvelope<T>(cachedValue, now + ttlMs);

				if (envelope.freshUntil > now) {
					return {
						value: envelope.value,
						cached: true,
						cacheMode: 'redis',
					};
				}

				if (refreshInBackground) {
					const refreshing = queueBackgroundRefresh(key, loader, ttlMs, staleWhileRevalidateMs, 'redis');

					return {
						value: envelope.value,
						cached: true,
						cacheMode: 'redis',
						stale: true,
						refreshing,
					};
				}

				const refreshedValue = await loader();
				await storeCachedValue(key, 'redis', refreshedValue, ttlMs, staleWhileRevalidateMs);

				return {
					value: refreshedValue,
					cached: false,
					cacheMode: 'redis',
				};
			}

			const value = await loader();
			await redis.set(key, serializeEnvelope(value, now + ttlMs), 'PX', totalTtlMs);

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

	if (existingEntry && existingEntry.expiresAt > now) {
		const envelope = parseEnvelope<T>(existingEntry.value, existingEntry.freshUntil);

		if (envelope.freshUntil > now) {
			return {
				value: envelope.value,
				cached: true,
				cacheMode: 'memory',
			};
		}

		if (refreshInBackground) {
			const refreshing = queueBackgroundRefresh(key, loader, ttlMs, staleWhileRevalidateMs, 'memory');

			return {
				value: envelope.value,
				cached: true,
				cacheMode: 'memory',
				stale: true,
				refreshing,
			};
		}

		const refreshedValue = await loader();
		await storeCachedValue(key, 'memory', refreshedValue, ttlMs, staleWhileRevalidateMs);

		return {
			value: refreshedValue,
			cached: false,
			cacheMode: 'memory',
		};
	}

	const value = await loader();
	await storeCachedValue(key, 'memory', value, ttlMs, staleWhileRevalidateMs);

	return {
		value,
		cached: false,
		cacheMode: 'memory',
	};
}
