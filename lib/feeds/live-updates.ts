import { defaultFeedColumns } from '@/lib/config/default-columns';
import { FeedItem, FeedLiveUpdate, FeedSourceResult } from '@/lib/feeds/types';

declare global {
	var __newsDeckLiveUpdateSubscribers: Map<number, (event: FeedLiveUpdate) => void> | undefined;
	var __newsDeckLiveUpdateSequence: number | undefined;
	var __newsDeckLiveUpdateSubscriberSequence: number | undefined;
}

const subscribers = globalThis.__newsDeckLiveUpdateSubscribers ?? (globalThis.__newsDeckLiveUpdateSubscribers = new Map<number, (event: FeedLiveUpdate) => void>());

function nextEventId() {
	const sequence = (globalThis.__newsDeckLiveUpdateSequence ?? 0) + 1;
	globalThis.__newsDeckLiveUpdateSequence = sequence;
	return `${Date.now()}-${sequence}`;
}

function nextSubscriberId() {
	const sequence = (globalThis.__newsDeckLiveUpdateSubscriberSequence ?? 0) + 1;
	globalThis.__newsDeckLiveUpdateSubscriberSequence = sequence;
	return sequence;
}

function isFeedItem(value: unknown): value is FeedItem {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<FeedItem>;
	return typeof candidate.id === 'string' && typeof candidate.title === 'string' && typeof candidate.url === 'string' && typeof candidate.sourceId === 'string';
}

function isFeedSourceResult(value: unknown): value is FeedSourceResult {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<FeedSourceResult>;
	return (
		Boolean(candidate.source) &&
		Array.isArray(candidate.items) &&
		candidate.items.every(isFeedItem) &&
		typeof candidate.fetchedAt === 'string' &&
		typeof candidate.staleAt === 'string'
	);
}

function getColumnIdsForSource(sourceId: string) {
	return defaultFeedColumns.filter((column) => column.sourceIds.includes(sourceId)).map((column) => column.id);
}

export function subscribeToFeedUpdates(listener: (event: FeedLiveUpdate) => void) {
	const subscriberId = nextSubscriberId();
	subscribers.set(subscriberId, listener);

	return () => {
		subscribers.delete(subscriberId);
	};
}

export function getFeedUpdateSubscriberCount() {
	return subscribers.size;
}

export function publishFeedUpdate(event: FeedLiveUpdate) {
	for (const listener of subscribers.values()) {
		try {
			listener(event);
		} catch (error) {
			console.error('Live update subscriber failed:', error);
		}
	}
}

export function publishFeedSourceUpdate(previousValue: unknown, nextValue: unknown) {
	if (!isFeedSourceResult(nextValue)) {
		return;
	}

	const previousItems = isFeedSourceResult(previousValue) ? previousValue.items : [];
	const previousIds = new Set(previousItems.map((item) => item.id));
	const newItems = nextValue.items.filter((item) => !previousIds.has(item.id));

	if (newItems.length === 0) {
		return;
	}

	publishFeedUpdate({
		eventId: nextEventId(),
		emittedAt: new Date().toISOString(),
		sourceId: nextValue.source.id,
		sourceTitle: nextValue.source.title,
		sourceKind: nextValue.source.kind,
		columnIds: getColumnIdsForSource(nextValue.source.id),
		fetchedAt: nextValue.fetchedAt,
		staleAt: nextValue.staleAt,
		totalItems: nextValue.items.length,
		newItems,
	});
}
