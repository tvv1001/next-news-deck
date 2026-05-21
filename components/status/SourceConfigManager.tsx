'use client';

import { useCallback, useMemo, useState } from 'react';

import type { FeedSourceConfig, FeedSourceKind, FeedSourceTestResult, FeedSourceWithMeta } from '@/lib/feeds/types';

type SourceFormState = {
	id: string;
	kind: FeedSourceKind;
	title: string;
	description: string;
	siteUrl: string;
	feedUrl: string;
	pollMinutes: string;
	maxItems: string;
	tags: string;
	userAgent: string;
	query: string;
	seedUrls: string;
	crawlDepth: string;
	crawlMaxPages: string;
	sameDomainOnly: boolean;
	crawlEngine: NonNullable<FeedSourceConfig['crawlEngine']>;
};

interface SourceConfigsResponse {
	sources: FeedSourceWithMeta[];
}

interface SourceConfigManagerProps {
	initialSources: FeedSourceWithMeta[];
}

const DEFAULT_RSS_FEED_URL = 'https://example.com/feed.xml';
const DEFAULT_RSS_SITE_URL = 'https://example.com';
const DEFAULT_CRAWL_URL = 'https://example.com/news';

function formatDuration(durationMs: number) {
	if (durationMs < 1000) {
		return `${durationMs}ms`;
	}

	return `${(durationMs / 1000).toFixed(1)}s`;
}

function createBlankForm(kind: FeedSourceKind = 'rss'): SourceFormState {
	return {
		id: '',
		kind,
		title: '',
		description: '',
		siteUrl: kind === 'web-crawl' ? DEFAULT_CRAWL_URL : DEFAULT_RSS_SITE_URL,
		feedUrl: kind === 'web-crawl' ? DEFAULT_CRAWL_URL : DEFAULT_RSS_FEED_URL,
		pollMinutes: kind === 'web-crawl' ? '2' : '10',
		maxItems: '18',
		tags: kind === 'web-crawl' ? 'watch, crawl' : 'news, rss',
		userAgent: '',
		query: '',
		seedUrls: kind === 'web-crawl' ? DEFAULT_CRAWL_URL : '',
		crawlDepth: '2',
		crawlMaxPages: '18',
		sameDomainOnly: kind === 'web-crawl',
		crawlEngine: 'scrapy',
	};
}

function toFormState(source: FeedSourceConfig): SourceFormState {
	return {
		id: source.id,
		kind: source.kind,
		title: source.title,
		description: source.description,
		siteUrl: source.siteUrl,
		feedUrl: source.feedUrl,
		pollMinutes: String(source.pollMinutes),
		maxItems: String(source.maxItems),
		tags: source.tags.join(', '),
		userAgent: source.userAgent ?? '',
		query: source.query ?? '',
		seedUrls: source.seedUrls?.join('\n') ?? '',
		crawlDepth: String(source.crawlDepth ?? 2),
		crawlMaxPages: String(source.crawlMaxPages ?? 18),
		sameDomainOnly: Boolean(source.sameDomainOnly),
		crawlEngine: source.crawlEngine ?? 'scrapy',
	};
}

function formToSourceConfig(form: SourceFormState): FeedSourceConfig {
	const tags = form.tags
		.split(/[\n,]/)
		.map((tag) => tag.trim())
		.filter(Boolean);
	const seedUrls = form.seedUrls
		.split('\n')
		.map((seedUrl) => seedUrl.trim())
		.filter(Boolean);

	return {
		id: form.id.trim().toLowerCase(),
		kind: form.kind,
		title: form.title.trim(),
		description: form.description.trim(),
		siteUrl: form.siteUrl.trim(),
		feedUrl: form.feedUrl.trim(),
		pollMinutes: Number(form.pollMinutes),
		maxItems: Number(form.maxItems),
		tags,
		userAgent: form.userAgent.trim() || undefined,
		query: form.query.trim() || undefined,
		seedUrls: form.kind === 'web-crawl' ? seedUrls : undefined,
		crawlDepth: form.kind === 'web-crawl' ? Number(form.crawlDepth) : undefined,
		crawlMaxPages: form.kind === 'web-crawl' ? Number(form.crawlMaxPages) : undefined,
		sameDomainOnly: form.kind === 'web-crawl' ? form.sameDomainOnly : undefined,
		crawlEngine: form.kind === 'web-crawl' ? form.crawlEngine : undefined,
	};
}

function ToneBadge({ ok }: { ok: boolean }) {
	return (
		<span
			className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
				ok ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100' : 'border-rose-400/30 bg-rose-500/10 text-rose-100'
			}`}>
			{ok ? 'reachable' : 'needs attention'}
		</span>
	);
}

export function SourceConfigManager({ initialSources }: SourceConfigManagerProps) {
	const [sources, setSources] = useState<FeedSourceWithMeta[]>(initialSources);
	const [formState, setFormState] = useState<SourceFormState>(() => (initialSources[0] ? toFormState(initialSources[0]) : createBlankForm('rss')));
	const [selectedSourceId, setSelectedSourceId] = useState<string | null>(initialSources[0]?.id ?? null);
	const [isCreating, setIsCreating] = useState(initialSources.length === 0);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isTesting, setIsTesting] = useState(false);
	const [testResults, setTestResults] = useState<Record<string, FeedSourceTestResult>>({});
	const [error, setError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const selectedSource = useMemo(() => sources.find((source) => source.id === selectedSourceId) ?? null, [selectedSourceId, sources]);
	const selectedTestResult = selectedSourceId ? testResults[selectedSourceId] : undefined;

	const loadSources = useCallback(async () => {
		setIsLoading(true);
		setError(null);

		try {
			const response = await fetch('/api/source-configs', { cache: 'no-store' });
			if (!response.ok) {
				throw new Error(`Source config request failed (${response.status}).`);
			}

			const payload = (await response.json()) as SourceConfigsResponse;
			setSources(payload.sources);

			if (payload.sources.length === 0) {
				setSelectedSourceId(null);
				setIsCreating(true);
				setFormState(createBlankForm('rss'));
			} else if (!selectedSourceId || !payload.sources.some((source) => source.id === selectedSourceId)) {
				setSelectedSourceId(payload.sources[0].id);
				setIsCreating(false);
				setFormState(toFormState(payload.sources[0]));
			}
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : 'Unable to load source configurations.');
		} finally {
			setIsLoading(false);
		}
	}, [selectedSourceId]);

	function updateForm<K extends keyof SourceFormState>(key: K, value: SourceFormState[K]) {
		setFormState((current) => ({ ...current, [key]: value }));
	}

	function beginCreate(kind: FeedSourceKind) {
		setIsCreating(true);
		setSelectedSourceId(null);
		setSuccessMessage(null);
		setError(null);
		setFormState(createBlankForm(kind));
	}

	function beginEdit(source: FeedSourceWithMeta) {
		setIsCreating(false);
		setSelectedSourceId(source.id);
		setSuccessMessage(null);
		setError(null);
		setFormState(toFormState(source));
	}

	async function saveSource() {
		setIsSaving(true);
		setError(null);
		setSuccessMessage(null);

		try {
			const source = formToSourceConfig(formState);
			const endpoint = isCreating ? '/api/source-configs' : `/api/source-configs/${encodeURIComponent(source.id)}`;
			const method = isCreating ? 'POST' : 'PUT';
			const response = await fetch(endpoint, {
				method,
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({ source }),
			});
			const payload = (await response.json()) as { error?: string; sources?: FeedSourceWithMeta[]; source?: FeedSourceConfig };
			if (!response.ok) {
				throw new Error(payload.error ?? 'Unable to save source configuration.');
			}

			const nextSources = payload.sources ?? sources;
			const nextSourceId = payload.source?.id ?? source.id;
			setSources(nextSources);
			setSelectedSourceId(nextSourceId);
			setIsCreating(false);
			setFormState(toFormState(nextSources.find((entry) => entry.id === nextSourceId) ?? source));
			setSuccessMessage(`Saved ${payload.source?.title ?? source.title}.`);
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : 'Unable to save source configuration.');
		} finally {
			setIsSaving(false);
		}
	}

	async function deleteSource(sourceId: string) {
		const source = sources.find((entry) => entry.id === sourceId);
		if (!source) {
			return;
		}

		if (!window.confirm(`Remove ${source.title}? Built-in sources can be restored later by saving them again.`)) {
			return;
		}

		setError(null);
		setSuccessMessage(null);

		try {
			const response = await fetch(`/api/source-configs/${encodeURIComponent(sourceId)}`, {
				method: 'DELETE',
			});
			const payload = (await response.json()) as { error?: string; sources?: FeedSourceWithMeta[] };
			if (!response.ok) {
				throw new Error(payload.error ?? 'Unable to delete source configuration.');
			}

			const nextSources = payload.sources ?? sources.filter((entry) => entry.id !== sourceId);
			setSources(nextSources);
			setSuccessMessage(`Removed ${source.title}.`);
			setTestResults((current) => {
				const nextResults = { ...current };
				delete nextResults[sourceId];
				return nextResults;
			});

			if (selectedSourceId === sourceId) {
				if (nextSources[0]) {
					beginEdit(nextSources[0]);
				} else {
					beginCreate('rss');
				}
			}
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : 'Unable to delete source configuration.');
		}
	}

	async function testSource(source?: FeedSourceConfig, sourceId?: string) {
		setIsTesting(true);
		setError(null);
		setSuccessMessage(null);

		try {
			const response = await fetch('/api/source-configs/test', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify(source ? { source } : { sourceId }),
			});
			const payload = (await response.json()) as { error?: string; result?: FeedSourceTestResult };
			if (!response.ok || !payload.result) {
				throw new Error(payload.error ?? 'Unable to test source configuration.');
			}

			const result = payload.result;

			setTestResults((current) => ({ ...current, [result.sourceId]: result }));
			setSelectedSourceId(result.sourceId);
			setSuccessMessage(`Tested ${result.sourceTitle}.`);
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : 'Unable to test source configuration.');
		} finally {
			setIsTesting(false);
		}
	}

	const sourceCountLabel = isLoading ? 'Loading…' : `${sources.length} configured`;

	return (
		<div className='rounded-3xl border border-white/10 bg-slate-950/55 p-4 shadow-xl backdrop-blur-sm'>
			<div className='flex flex-wrap items-start justify-between gap-3'>
				<div>
					<h2 className='text-lg font-semibold text-white'>Feed & crawl source controls</h2>
					<p className='mt-1 max-w-3xl text-sm text-slate-400'>
						Add, edit, remove, and test RSS, Reddit, or crawl-backed sources directly from the status page. Tests run the real server-side fetch pipeline so you can see whether a
						feed or crawl target is actually reachable.
					</p>
				</div>
				<div className='flex flex-wrap gap-2'>
					<span className='rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300'>{sourceCountLabel}</span>
					<button
						type='button'
						onClick={() => beginCreate('rss')}
						className='rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-cyan-300/30 hover:text-white'>
						New RSS
					</button>
					<button
						type='button'
						onClick={() => beginCreate('web-crawl')}
						className='rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-cyan-300/30 hover:text-white'>
						New crawl
					</button>
					<button
						type='button'
						onClick={() => beginCreate('reddit')}
						className='rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-cyan-300/30 hover:text-white'>
						New Reddit
					</button>
				</div>
			</div>

			{error ?
				<p className='mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-100'>{error}</p>
			:	null}
			{successMessage ?
				<p className='mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100'>{successMessage}</p>
			:	null}

			<div className='mt-4 grid gap-4 xl:grid-cols-[1.1fr_1.4fr]'>
				<div className='space-y-3'>
					<div className='rounded-2xl border border-white/8 bg-white/3 p-3'>
						<div className='flex items-center justify-between gap-2'>
							<h3 className='text-sm font-semibold text-white'>Configured sources</h3>
							<button
								type='button'
								onClick={() => void loadSources()}
								className='rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:border-cyan-300/30 hover:text-white'>
								Reload
							</button>
						</div>
						<div className='mt-3 space-y-2'>
							{sources.length === 0 ?
								<p className='rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-400'>No saved sources yet. Create one from the buttons above.</p>
							:	sources.map((source) => {
									const testResult = testResults[source.id];
									const isSelected = source.id === selectedSourceId && !isCreating;

									return (
										<div
											key={source.id}
											className={`rounded-2xl border px-3 py-3 transition ${isSelected ? 'border-cyan-300/35 bg-cyan-400/8' : 'border-white/8 bg-slate-950/45'}`}>
											<div className='flex flex-wrap items-start justify-between gap-3'>
												<div>
													<div className='flex flex-wrap items-center gap-2'>
														<p className='font-medium text-white'>{source.title}</p>
														<span className='rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-300'>{source.kind}</span>
														{source.builtIn ?
															<span className='rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-300'>built-in</span>
														:	null}
														{testResult ?
															<ToneBadge ok={testResult.ok} />
														:	null}
													</div>
													<p className='mt-1 text-xs text-slate-400'>{source.id}</p>
													<p className='mt-2 text-sm text-slate-300'>{source.description}</p>
												</div>
												<div className='flex flex-wrap gap-2'>
													<button
														type='button'
														onClick={() => beginEdit(source)}
														className='rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-100 transition hover:border-cyan-300/30 hover:text-white'>
														Edit
													</button>
													<button
														type='button'
														onClick={() => void testSource(undefined, source.id)}
														className='rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-100 transition hover:border-cyan-300/30 hover:text-white'>
														Test
													</button>
													<button
														type='button'
														onClick={() => void deleteSource(source.id)}
														className='rounded-full border border-rose-300/20 px-2.5 py-1 text-[11px] font-medium text-rose-100 transition hover:border-rose-300/40 hover:text-white'>
														Remove
													</button>
												</div>
											</div>
											<div className='mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300'>
												<span className='rounded-full border border-white/10 bg-white/5 px-2 py-1'>poll {source.pollMinutes}m</span>
												<span className='rounded-full border border-white/10 bg-white/5 px-2 py-1'>max {source.maxItems}</span>
												{source.attachedColumnIds.length > 0 ?
													<span className='rounded-full border border-white/10 bg-white/5 px-2 py-1'>columns {source.attachedColumnIds.join(', ')}</span>
												:	null}
											</div>
											{testResult ?
												<div className='mt-3 rounded-2xl border border-white/8 bg-white/3 px-3 py-3 text-sm'>
													<p className='text-white'>
														Last test: {testResult.itemCount} items • {formatDuration(testResult.durationMs)}
													</p>
													<p className='mt-1 text-xs text-slate-400'>{testResult.error ?? `Tested ${new Date(testResult.testedAt).toLocaleString()}`}</p>
												</div>
											:	null}
										</div>
									);
								})
							}
						</div>
					</div>
				</div>

				<div className='space-y-3'>
					<div className='rounded-2xl border border-white/8 bg-white/3 p-3'>
						<div className='flex flex-wrap items-center justify-between gap-2'>
							<div>
								<h3 className='text-sm font-semibold text-white'>{isCreating ? 'Create a source' : `Edit ${selectedSource?.title ?? 'source'}`}</h3>
								<p className='text-xs text-slate-400'>RSS and Reddit use `feedUrl`; crawl sources additionally use `seedUrls`, depth, and page limits.</p>
							</div>
							<div className='flex gap-2'>
								<button
									type='button'
									onClick={() => void testSource(formToSourceConfig(formState))}
									disabled={isTesting}
									className='rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-medium text-slate-100 transition hover:border-cyan-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60'>
									{isTesting ? 'Testing…' : 'Test current config'}
								</button>
								<button
									type='button'
									onClick={() => (selectedSource ? beginEdit(selectedSource) : beginCreate(formState.kind))}
									className='rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-medium text-slate-100 transition hover:border-cyan-300/30 hover:text-white'>
									Reset
								</button>
							</div>
						</div>

						<div className='mt-4 grid gap-3 md:grid-cols-2'>
							<label className='text-sm text-slate-300'>
								<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Source ID</span>
								<input
									value={formState.id}
									onChange={(event) => updateForm('id', event.target.value)}
									disabled={!isCreating}
									className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-60'
									placeholder='new-source-id'
								/>
							</label>
							<label className='text-sm text-slate-300'>
								<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Kind</span>
								<select
									value={formState.kind}
									onChange={(event) => {
										const nextKind = event.target.value as FeedSourceKind;
										setFormState((current) => ({
											...createBlankForm(nextKind),
											id: current.id,
											title: current.title,
											description: current.description,
											tags: current.tags,
											userAgent: current.userAgent,
										}));
									}}
									className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'>
									<option value='rss'>RSS</option>
									<option value='reddit'>Reddit RSS</option>
									<option value='web-crawl'>Web crawl</option>
								</select>
							</label>
							<label className='text-sm text-slate-300 md:col-span-2'>
								<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Title</span>
								<input
									value={formState.title}
									onChange={(event) => updateForm('title', event.target.value)}
									className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
								/>
							</label>
							<label className='text-sm text-slate-300 md:col-span-2'>
								<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Description</span>
								<textarea
									value={formState.description}
									onChange={(event) => updateForm('description', event.target.value)}
									rows={2}
									className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
								/>
							</label>
							<label className='text-sm text-slate-300'>
								<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Site URL</span>
								<input
									value={formState.siteUrl}
									onChange={(event) => updateForm('siteUrl', event.target.value)}
									className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
								/>
							</label>
							<label className='text-sm text-slate-300'>
								<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>{formState.kind === 'web-crawl' ? 'Primary crawl URL' : 'Feed URL'}</span>
								<input
									value={formState.feedUrl}
									onChange={(event) => updateForm('feedUrl', event.target.value)}
									className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
								/>
							</label>
							<label className='text-sm text-slate-300'>
								<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Poll minutes</span>
								<input
									type='number'
									min='1'
									max='720'
									value={formState.pollMinutes}
									onChange={(event) => updateForm('pollMinutes', event.target.value)}
									className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
								/>
							</label>
							<label className='text-sm text-slate-300'>
								<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Max items</span>
								<input
									type='number'
									min='1'
									max='100'
									value={formState.maxItems}
									onChange={(event) => updateForm('maxItems', event.target.value)}
									className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
								/>
							</label>
							<label className='text-sm text-slate-300 md:col-span-2'>
								<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Tags</span>
								<input
									value={formState.tags}
									onChange={(event) => updateForm('tags', event.target.value)}
									className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
									placeholder='markets, tsla, watch'
								/>
							</label>
							<label className='text-sm text-slate-300 md:col-span-2'>
								<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Custom user agent (optional)</span>
								<input
									value={formState.userAgent}
									onChange={(event) => updateForm('userAgent', event.target.value)}
									className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
								/>
							</label>

							{formState.kind === 'web-crawl' ?
								<>
									<label className='text-sm text-slate-300 md:col-span-2'>
										<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Query / relevance hint</span>
										<input
											value={formState.query}
											onChange={(event) => updateForm('query', event.target.value)}
											className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
											placeholder='TSLA earnings robotaxi'
										/>
									</label>
									<label className='text-sm text-slate-300 md:col-span-2'>
										<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Seed URLs (one per line)</span>
										<textarea
											value={formState.seedUrls}
											onChange={(event) => updateForm('seedUrls', event.target.value)}
											rows={5}
											className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
										/>
									</label>
									<label className='text-sm text-slate-300'>
										<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Crawl depth</span>
										<input
											type='number'
											min='1'
											max='8'
											value={formState.crawlDepth}
											onChange={(event) => updateForm('crawlDepth', event.target.value)}
											className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
										/>
									</label>
									<label className='text-sm text-slate-300'>
										<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Crawl max pages</span>
										<input
											type='number'
											min='1'
											max='200'
											value={formState.crawlMaxPages}
											onChange={(event) => updateForm('crawlMaxPages', event.target.value)}
											className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'
										/>
									</label>
									<label className='text-sm text-slate-300'>
										<span className='mb-1 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Crawler engine</span>
										<select
											value={formState.crawlEngine}
											onChange={(event) => updateForm('crawlEngine', event.target.value as SourceFormState['crawlEngine'])}
											className='w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-white outline-none transition focus:border-cyan-300/40'>
											<option value='scrapy'>Scrapy</option>
											<option value='cheerio'>Cheerio</option>
										</select>
									</label>
									<label className='flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-200'>
										<input
											type='checkbox'
											checked={formState.sameDomainOnly}
											onChange={(event) => updateForm('sameDomainOnly', event.target.checked)}
										/>
										<span>Keep crawl constrained to the same domain when possible.</span>
									</label>
								</>
							:	null}
						</div>

						<div className='mt-4 flex flex-wrap gap-2'>
							<button
								type='button'
								onClick={() => void saveSource()}
								disabled={isSaving}
								className='rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60'>
								{isSaving ?
									'Saving…'
								: isCreating ?
									'Create source'
								:	'Save changes'}
							</button>
							{!isCreating && selectedSource ?
								<button
									type='button'
									onClick={() => void deleteSource(selectedSource.id)}
									className='rounded-full border border-rose-300/20 px-4 py-2 text-sm font-medium text-rose-100 transition hover:border-rose-300/40 hover:text-white'>
									Delete source
								</button>
							:	null}
						</div>
					</div>

					<div className='rounded-2xl border border-white/8 bg-white/3 p-3'>
						<h3 className='text-sm font-semibold text-white'>Latest test result</h3>
						{selectedTestResult ?
							<div className='mt-3 space-y-3'>
								<div className='flex flex-wrap items-center gap-2'>
									<ToneBadge ok={selectedTestResult.ok} />
									<span className='rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300'>{selectedTestResult.itemCount} items</span>
									<span className='rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300'>{formatDuration(selectedTestResult.durationMs)}</span>
								</div>
								<p className='text-sm text-slate-300'>
									{selectedTestResult.error ?? `Fetched ${selectedTestResult.sourceTitle} successfully at ${new Date(selectedTestResult.testedAt).toLocaleTimeString()}.`}
								</p>
								{selectedTestResult.sampleTitles.length > 0 ?
									<div>
										<p className='text-[11px] uppercase tracking-[0.18em] text-slate-400'>Sample items</p>
										<ul className='mt-2 space-y-2 text-sm text-slate-200'>
											{selectedTestResult.sampleTitles.map((title, index) => (
												<li
													key={`${selectedTestResult.sourceId}-${index}`}
													className='rounded-xl border border-white/8 bg-slate-950/45 px-3 py-2'>
													<a
														href={selectedTestResult.sampleUrls[index]}
														target='_blank'
														rel='noreferrer'
														className='transition hover:text-cyan-200'>
														{title}
													</a>
												</li>
											))}
										</ul>
									</div>
								:	null}
							</div>
						:	<p className='mt-3 text-sm text-slate-400'>Run a source test to see whether the server can fetch RSS or crawl results and what sample items came back.</p>}
					</div>

					<div className='rounded-2xl border border-dashed border-cyan-300/20 bg-cyan-500/6 p-3 text-sm text-cyan-50'>
						<h3 className='font-semibold text-white'>How this affects the app</h3>
						<ul className='mt-2 space-y-2 text-cyan-50/90'>
							<li>• Editing a built-in source changes what the server fetches for any column already attached to that source ID.</li>
							<li>• Removing a built-in source detaches it from fetching without changing the default column definitions themselves.</li>
							<li>• Tests use the same server-side adapters as the live dashboard, so a passing test is a real signal that the source is reachable.</li>
						</ul>
					</div>
				</div>
			</div>
		</div>
	);
}
