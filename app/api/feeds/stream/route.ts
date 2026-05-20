import { NextRequest } from 'next/server';

import { subscribeToFeedUpdates } from '@/lib/feeds/live-updates';

const encoder = new TextEncoder();
const HEARTBEAT_MS = 25_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function encodeSseMessage(event: string, data: unknown, id?: string) {
	const lines = [id ? `id: ${id}` : '', `event: ${event}`, `data: ${JSON.stringify(data)}`, ''];
	return encoder.encode(lines.filter(Boolean).join('\n') + '\n\n');
}

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);
	const requestedColumnIds = [...new Set(searchParams.getAll('columnId').filter(Boolean))];

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			let heartbeatId: ReturnType<typeof setInterval> | null = null;
			let unsubscribe: () => void = () => {};

			const send = (event: string, data: unknown, id?: string) => {
				if (closed) {
					return;
				}

				controller.enqueue(encodeSseMessage(event, data, id));
			};

			const close = () => {
				if (closed) {
					return;
				}

				closed = true;

				if (heartbeatId) {
					clearInterval(heartbeatId);
				}

				unsubscribe();
				controller.close();
			};

			unsubscribe = subscribeToFeedUpdates((event) => {
				if (requestedColumnIds.length > 0 && !event.columnIds.some((columnId) => requestedColumnIds.includes(columnId))) {
					return;
				}

				send('feed-update', event, event.eventId);
			});

			heartbeatId = setInterval(() => {
				send('ping', { ts: new Date().toISOString() });
			}, HEARTBEAT_MS);

			send('ready', {
				connectedAt: new Date().toISOString(),
				columnIds: requestedColumnIds,
				retryMs: 3_000,
			});

			request.signal.addEventListener('abort', close, { once: true });
		},
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			'connection': 'keep-alive',
			'x-accel-buffering': 'no',
		},
	});
}
