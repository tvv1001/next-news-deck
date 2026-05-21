'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SourceConfigManager } from '@/components/status/SourceConfigManager';
import type { FeedLiveUpdate, FeedSourceWithMeta } from '@/lib/feeds/types';

type ConnectionState = 'connecting' | 'open' | 'error' | 'closed';

interface SseReadyPayload {
	connectedAt: string;
	columnIds: string[];
	retryMs: number;
}

interface SsePingPayload {
	ts: string;
}

interface HealthSnapshot {
	status: string;
	cacheMode: string;
	liveSubscribers: number;
	redisConfigured: boolean;
	sourceCount: number;
	columnCount: number;
	checkedAt: string;
}

interface TimelineEntry {
	id: string;
	type: 'ready' | 'ping' | 'feed-update' | 'error' | 'open';
	title: string;
	detail: string;
	at: string;
}

const HEALTH_POLL_MS = 10_000;
const MAX_TIMELINE_ENTRIES = 12;

function formatDateTime(value: string | null) {
	if (!value) {
		return '—';
	}

	return new Intl.DateTimeFormat('en', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		day: '2-digit',
		month: 'short',
	}).format(new Date(value));
}

function formatRelativeTime(value: string | null) {
	if (!value) {
		return '—';
	}

	const diffMs = Date.now() - new Date(value).getTime();
	const diffSeconds = Math.max(0, Math.round(diffMs / 1_000));

	if (diffSeconds < 5) {
		return 'just now';
	}

	if (diffSeconds < 60) {
		return `${diffSeconds}s ago`;
	}

	const diffMinutes = Math.round(diffSeconds / 60);
	if (diffMinutes < 60) {
		return `${diffMinutes}m ago`;
	}

	const diffHours = Math.round(diffMinutes / 60);
	return `${diffHours}h ago`;
}

function addTimelineEntry(current: TimelineEntry[], entry: TimelineEntry) {
	return [entry, ...current].slice(0, MAX_TIMELINE_ENTRIES);
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
	return (
		<div className='rounded-3xl border border-white/10 bg-slate-950/55 p-4 shadow-xl backdrop-blur-sm'>
			<p className='text-[11px] uppercase tracking-[0.18em] text-slate-400'>{label}</p>
			<p className='mt-2 text-2xl font-semibold text-white'>{value}</p>
			{hint ?
				<p className='mt-1 text-xs text-slate-400'>{hint}</p>
			:	null}
		</div>
	);
}

export function SseStatusPage({ initialSources }: { initialSources: FeedSourceWithMeta[] }) {
	const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
	const [health, setHealth] = useState<HealthSnapshot | null>(null);
	const [readyPayload, setReadyPayload] = useState<SseReadyPayload | null>(null);
	const [lastPingAt, setLastPingAt] = useState<string | null>(null);
	const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(null);
	const [lastErrorAt, setLastErrorAt] = useState<string | null>(null);
	const [lastOpenedAt, setLastOpenedAt] = useState<string | null>(null);
	const [pingCount, setPingCount] = useState(0);
	const [updateCount, setUpdateCount] = useState(0);
	const [errorCount, setErrorCount] = useState(0);
	const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
	const [recentUpdates, setRecentUpdates] = useState<FeedLiveUpdate[]>([]);
	const [statusMessage, setStatusMessage] = useState('Opening EventSource…');
	const [reconnectNonce, setReconnectNonce] = useState(0);
	const eventSourceRef = useRef<EventSource | null>(null);

	const fetchHealth = useCallback(async () => {
		const response = await fetch('/api/health', { cache: 'no-store' });

		if (!response.ok) {
			throw new Error(`Health endpoint returned ${response.status}`);
		}

		const payload = (await response.json()) as HealthSnapshot;
		setHealth(payload);
	}, []);

	useEffect(() => {
		let cancelled = false;

		const loadHealth = async () => {
			try {
				await fetchHealth();
			} catch (error) {
				if (!cancelled) {
					setStatusMessage(error instanceof Error ? error.message : 'Unable to load health snapshot.');
				}
			}
		};

		void loadHealth();

		const intervalId = window.setInterval(() => {
			void loadHealth();
		}, HEALTH_POLL_MS);

		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	}, [fetchHealth]);

	useEffect(() => {
		const eventSource = new EventSource('/api/feeds/stream');
		eventSourceRef.current = eventSource;

		const handleOpen = () => {
			const now = new Date().toISOString();
			setConnectionState('open');
			setLastOpenedAt(now);
			setStatusMessage('Connected to /api/feeds/stream');
			setTimeline((current) =>
				addTimelineEntry(current, {
					id: `${now}-open`,
					type: 'open',
					title: 'Connection opened',
					detail: 'Browser EventSource session established.',
					at: now,
				}),
			);
		};

		const handleReady = (event: MessageEvent<string>) => {
			try {
				const payload = JSON.parse(event.data) as SseReadyPayload;
				setReadyPayload(payload);
				setStatusMessage(`Ready event received${payload.retryMs ? ` • retry ${payload.retryMs}ms` : ''}`);
				setTimeline((current) =>
					addTimelineEntry(current, {
						id: `${payload.connectedAt}-ready`,
						type: 'ready',
						title: 'Ready event',
						detail: payload.columnIds.length > 0 ? `Subscribed to ${payload.columnIds.length} filtered column(s).` : 'Subscribed to the full stream with no column filter.',
						at: payload.connectedAt,
					}),
				);
			} catch (error) {
				setStatusMessage(error instanceof Error ? error.message : 'Unable to parse ready payload.');
			}
		};

		const handlePing = (event: MessageEvent<string>) => {
			try {
				const payload = JSON.parse(event.data) as SsePingPayload;
				setPingCount((current) => current + 1);
				setLastPingAt(payload.ts);
				setTimeline((current) =>
					addTimelineEntry(current, {
						id: `${payload.ts}-ping`,
						type: 'ping',
						title: 'Heartbeat',
						detail: 'Server heartbeat received.',
						at: payload.ts,
					}),
				);
			} catch {
				setStatusMessage('Unable to parse ping payload.');
			}
		};

		const handleFeedUpdate = (event: MessageEvent<string>) => {
			try {
				const payload = JSON.parse(event.data) as FeedLiveUpdate;
				setUpdateCount((current) => current + 1);
				setLastUpdateAt(payload.emittedAt);
				setRecentUpdates((current) => [payload, ...current].slice(0, 8));
				setTimeline((current) =>
					addTimelineEntry(current, {
						id: payload.eventId,
						type: 'feed-update',
						title: payload.sourceTitle,
						detail: `${payload.newItems.length} new item${payload.newItems.length === 1 ? '' : 's'} • ${payload.columnIds.join(', ') || 'all columns'}`,
						at: payload.emittedAt,
					}),
				);
				setStatusMessage(`Last update from ${payload.sourceTitle}`);
			} catch {
				setStatusMessage('Unable to parse feed-update payload.');
			}
		};

		const handleError = () => {
			const now = new Date().toISOString();
			setConnectionState('error');
			setLastErrorAt(now);
			setErrorCount((current) => current + 1);
			setStatusMessage('Connection dropped; waiting for the browser to retry…');
			setTimeline((current) =>
				addTimelineEntry(current, {
					id: `${now}-error`,
					type: 'error',
					title: 'Connection error',
					detail: 'The browser reported an SSE transport problem and will retry automatically.',
					at: now,
				}),
			);
		};

		eventSource.onopen = handleOpen;
		eventSource.onerror = handleError;
		eventSource.addEventListener('ready', handleReady as EventListener);
		eventSource.addEventListener('ping', handlePing as EventListener);
		eventSource.addEventListener('feed-update', handleFeedUpdate as EventListener);

		return () => {
			eventSource.removeEventListener('ready', handleReady as EventListener);
			eventSource.removeEventListener('ping', handlePing as EventListener);
			eventSource.removeEventListener('feed-update', handleFeedUpdate as EventListener);
			eventSource.close();
			if (eventSourceRef.current === eventSource) {
				eventSourceRef.current = null;
			}
		};
	}, [reconnectNonce]);

	const connectionTone = useMemo(() => {
		switch (connectionState) {
			case 'open':
				return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100';
			case 'error':
				return 'border-rose-400/30 bg-rose-500/10 text-rose-100';
			case 'closed':
				return 'border-slate-400/30 bg-slate-500/10 text-slate-200';
			default:
				return 'border-amber-400/30 bg-amber-500/10 text-amber-100';
		}
	}, [connectionState]);

	const reconnect = useCallback(() => {
		eventSourceRef.current?.close();
		setConnectionState('connecting');
		setStatusMessage('Opening EventSource…');
		setReconnectNonce((current) => current + 1);
	}, []);

	return (
		<div className='h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.18),transparent_26%),linear-gradient(180deg,#020617_0%,#0f172a_48%,#020617_100%)] text-slate-50'>
			<main className='mx-auto flex h-screen max-w-7xl flex-col overflow-hidden px-3 py-3 sm:px-4 lg:px-5'>
				<header className='shrink-0 rounded-3xl border border-white/10 bg-slate-950/55 px-4 py-4 shadow-2xl backdrop-blur-sm'>
					<div className='flex flex-wrap items-start justify-between gap-3'>
						<div>
							<p className='text-xs uppercase tracking-[0.18em] text-cyan-200/80'>Diagnostics</p>
							<h1 className='mt-1 text-2xl font-semibold text-white sm:text-3xl'>SSE status</h1>
							<p className='mt-2 max-w-2xl text-sm text-slate-300'>
								This page opens its own connection to <code className='rounded bg-white/5 px-1 py-0.5 text-cyan-100'>/api/feeds/stream</code> and shows heartbeats, reconnects, and
								live feed-update events in real time.
							</p>
						</div>

						<div className='flex flex-wrap gap-2'>
							<Link
								href='/'
								className='rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-cyan-300/30 hover:text-white'>
								Back to deck
							</Link>
							<button
								type='button'
								onClick={() => void fetchHealth()}
								className='rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-cyan-300/30 hover:text-white'>
								Refresh health
							</button>
							<button
								type='button'
								onClick={reconnect}
								className='rounded-full bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300'>
								Reconnect SSE
							</button>
						</div>
					</div>

					<div className='mt-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-300'>
						<span className={`rounded-full border px-2.5 py-1 font-medium ${connectionTone}`}>{connectionState}</span>
						<span className='rounded-full border border-white/10 bg-white/5 px-2.5 py-1'>endpoint /api/feeds/stream</span>
						<span className='rounded-full border border-white/10 bg-white/5 px-2.5 py-1'>health polled every {HEALTH_POLL_MS / 1000}s</span>
						<span className='rounded-full border border-white/10 bg-white/5 px-2.5 py-1'>{statusMessage}</span>
					</div>
				</header>

				<section className='mt-3 min-h-0 flex-1 overflow-y-auto pb-2'>
					<div className='grid gap-3 lg:grid-cols-[1.35fr_0.95fr]'>
						<div className='space-y-3'>
							<div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
								<MetricCard
									label='Connection state'
									value={connectionState}
									hint={lastOpenedAt ? `Opened ${formatRelativeTime(lastOpenedAt)}` : 'Waiting for first open event'}
								/>
								<MetricCard
									label='Heartbeats'
									value={pingCount}
									hint={lastPingAt ? `Last ping ${formatRelativeTime(lastPingAt)}` : 'No ping received yet'}
								/>
								<MetricCard
									label='Feed updates'
									value={updateCount}
									hint={lastUpdateAt ? `Last update ${formatRelativeTime(lastUpdateAt)}` : 'No feed update yet'}
								/>
								<MetricCard
									label='Transport errors'
									value={errorCount}
									hint={lastErrorAt ? `Last error ${formatRelativeTime(lastErrorAt)}` : 'No transport errors seen'}
								/>
							</div>

							<div className='rounded-3xl border border-white/10 bg-slate-950/55 p-4 shadow-xl backdrop-blur-sm'>
								<div className='flex flex-wrap items-center justify-between gap-2'>
									<div>
										<h2 className='text-lg font-semibold text-white'>Recent SSE timeline</h2>
										<p className='text-sm text-slate-400'>A rolling log of the latest events seen by this browser tab.</p>
									</div>
									<span className='rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300'>{timeline.length} entries</span>
								</div>

								<div className='mt-4 space-y-2'>
									{timeline.length === 0 ?
										<p className='rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-400'>No events captured yet. The stream may still be connecting.</p>
									:	timeline.map((entry) => (
											<div
												key={entry.id}
												className='rounded-2xl border border-white/8 bg-white/3 px-3 py-3'>
												<div className='flex flex-wrap items-center justify-between gap-2'>
													<div>
														<p className='text-sm font-medium text-white'>{entry.title}</p>
														<p className='text-xs uppercase tracking-[0.18em] text-slate-500'>{entry.type}</p>
													</div>
													<div className='text-right'>
														<p className='text-sm text-slate-200'>{formatDateTime(entry.at)}</p>
														<p className='text-xs text-slate-500'>{formatRelativeTime(entry.at)}</p>
													</div>
												</div>
												<p className='mt-2 text-sm text-slate-300'>{entry.detail}</p>
											</div>
										))
									}
								</div>
							</div>

							<div className='rounded-3xl border border-white/10 bg-slate-950/55 p-4 shadow-xl backdrop-blur-sm'>
								<div className='flex flex-wrap items-center justify-between gap-2'>
									<div>
										<h2 className='text-lg font-semibold text-white'>Recent feed-update payloads</h2>
										<p className='text-sm text-slate-400'>The newest update events received from the server.</p>
									</div>
									<span className='rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300'>Latest {recentUpdates.length}</span>
								</div>

								<div className='mt-4 overflow-hidden rounded-2xl border border-white/8'>
									<div className='grid grid-cols-[1.4fr_0.8fr_1fr_1.2fr] gap-px bg-white/8 text-xs text-slate-300'>
										<div className='bg-slate-950/80 px-3 py-2 font-medium'>Source</div>
										<div className='bg-slate-950/80 px-3 py-2 font-medium'>New items</div>
										<div className='bg-slate-950/80 px-3 py-2 font-medium'>Columns</div>
										<div className='bg-slate-950/80 px-3 py-2 font-medium'>Emitted</div>
									</div>
									{recentUpdates.length === 0 ?
										<div className='bg-slate-950/55 px-3 py-4 text-sm text-slate-400'>No feed-update payloads received yet.</div>
									:	recentUpdates.map((update) => (
											<div
												key={update.eventId}
												className='grid grid-cols-[1.4fr_0.8fr_1fr_1.2fr] gap-px border-t border-white/8 bg-white/8 text-sm'>
												<div className='bg-slate-950/55 px-3 py-3'>
													<p className='font-medium text-white'>{update.sourceTitle}</p>
													<p className='text-xs text-slate-400'>{update.sourceId}</p>
												</div>
												<div className='bg-slate-950/55 px-3 py-3 text-slate-200'>{update.newItems.length}</div>
												<div className='bg-slate-950/55 px-3 py-3 text-slate-200'>{update.columnIds.join(', ')}</div>
												<div className='bg-slate-950/55 px-3 py-3 text-slate-300'>
													<div>{formatDateTime(update.emittedAt)}</div>
													<div className='text-xs text-slate-500'>{formatRelativeTime(update.emittedAt)}</div>
												</div>
											</div>
										))
									}
								</div>
							</div>
						</div>

						<div className='space-y-3'>
							<div className='rounded-3xl border border-white/10 bg-slate-950/55 p-4 shadow-xl backdrop-blur-sm'>
								<h2 className='text-lg font-semibold text-white'>Server snapshot</h2>
								<p className='mt-1 text-sm text-slate-400'>
									Polled from <code className='rounded bg-white/5 px-1 py-0.5 text-cyan-100'>/api/health</code>.
								</p>
								<dl className='mt-4 space-y-3 text-sm'>
									<div className='flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/3 px-3 py-3'>
										<dt className='text-slate-400'>Health status</dt>
										<dd className='font-medium text-white'>{health?.status ?? 'loading…'}</dd>
									</div>
									<div className='flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/3 px-3 py-3'>
										<dt className='text-slate-400'>Server-side SSE subscribers</dt>
										<dd className='font-medium text-white'>{health?.liveSubscribers ?? '—'}</dd>
									</div>
									<div className='flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/3 px-3 py-3'>
										<dt className='text-slate-400'>Cache mode</dt>
										<dd className='font-medium text-white'>{health?.cacheMode ?? '—'}</dd>
									</div>
									<div className='flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/3 px-3 py-3'>
										<dt className='text-slate-400'>Redis configured</dt>
										<dd className='font-medium text-white'>
											{health ?
												health.redisConfigured ?
													'yes'
												:	'no'
											:	'—'}
										</dd>
									</div>
									<div className='flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/3 px-3 py-3'>
										<dt className='text-slate-400'>Source / column count</dt>
										<dd className='font-medium text-white'>{health ? `${health.sourceCount} / ${health.columnCount}` : '—'}</dd>
									</div>
									<div className='flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/3 px-3 py-3'>
										<dt className='text-slate-400'>Last checked</dt>
										<dd className='font-medium text-white'>{health?.checkedAt ? `${formatDateTime(health.checkedAt)} • ${formatRelativeTime(health.checkedAt)}` : '—'}</dd>
									</div>
								</dl>
							</div>

							<div className='rounded-3xl border border-white/10 bg-slate-950/55 p-4 shadow-xl backdrop-blur-sm'>
								<h2 className='text-lg font-semibold text-white'>Handshake details</h2>
								<dl className='mt-4 space-y-3 text-sm'>
									<div className='rounded-2xl border border-white/8 bg-white/3 px-3 py-3'>
										<dt className='text-slate-400'>Ready connectedAt</dt>
										<dd className='mt-1 font-medium text-white'>{readyPayload?.connectedAt ? formatDateTime(readyPayload.connectedAt) : 'Waiting for ready event'}</dd>
									</div>
									<div className='rounded-2xl border border-white/8 bg-white/3 px-3 py-3'>
										<dt className='text-slate-400'>Retry interval</dt>
										<dd className='mt-1 font-medium text-white'>{readyPayload ? `${readyPayload.retryMs}ms` : '—'}</dd>
									</div>
									<div className='rounded-2xl border border-white/8 bg-white/3 px-3 py-3'>
										<dt className='text-slate-400'>Requested column filter</dt>
										<dd className='mt-1 font-medium text-white'>
											{readyPayload ?
												readyPayload.columnIds.length > 0 ?
													readyPayload.columnIds.join(', ')
												:	'None — listening to all columns'
											:	'—'}
										</dd>
									</div>
									<div className='rounded-2xl border border-white/8 bg-white/3 px-3 py-3'>
										<dt className='text-slate-400'>Last open / ping / update</dt>
										<dd className='mt-1 space-y-1 text-white'>
											<div>open: {lastOpenedAt ? `${formatDateTime(lastOpenedAt)} • ${formatRelativeTime(lastOpenedAt)}` : '—'}</div>
											<div>ping: {lastPingAt ? `${formatDateTime(lastPingAt)} • ${formatRelativeTime(lastPingAt)}` : '—'}</div>
											<div>update: {lastUpdateAt ? `${formatDateTime(lastUpdateAt)} • ${formatRelativeTime(lastUpdateAt)}` : '—'}</div>
										</dd>
									</div>
								</dl>
							</div>

							<div className='rounded-3xl border border-dashed border-cyan-300/20 bg-cyan-500/6 p-4 text-sm text-cyan-50 shadow-xl'>
								<h2 className='text-base font-semibold text-white'>What this verifies</h2>
								<ul className='mt-3 space-y-2 text-cyan-50/90'>
									<li>• The browser can establish an SSE connection.</li>
									<li>
										• The server emits the initial <code className='rounded bg-slate-950/40 px-1 py-0.5'>ready</code> event.
									</li>
									<li>• Heartbeats keep flowing even when there are no feed updates.</li>
									<li>• Feed-change notifications arrive with source and column metadata.</li>
								</ul>
							</div>
						</div>
					</div>

					<div className='mt-3'>
						<SourceConfigManager initialSources={initialSources} />
					</div>
				</section>
			</main>
		</div>
	);
}
