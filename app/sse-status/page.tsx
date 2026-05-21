import type { Metadata } from 'next';

import { SseStatusPage } from '@/components/status/SseStatusPage';

export const metadata: Metadata = {
	title: 'SSE Status | Next News Deck',
	description: 'Live monitoring page for the Next News Deck Server-Sent Events stream.',
};

export default function SseStatusRoute() {
	return <SseStatusPage />;
}
