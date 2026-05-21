import type { Metadata } from 'next';

import { SseStatusPage } from '@/components/status/SseStatusPage';
import { getConfiguredSourcesWithMeta } from '@/lib/config/source-registry';

export const metadata: Metadata = {
	title: 'SSE Status | Next News Deck',
	description: 'Live monitoring page for the Next News Deck Server-Sent Events stream.',
};

export default async function SseStatusRoute() {
	const initialSources = await getConfiguredSourcesWithMeta();

	return <SseStatusPage initialSources={initialSources} />;
}
