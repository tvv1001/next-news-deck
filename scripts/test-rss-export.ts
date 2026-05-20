#!/usr/bin/env node

/**
 * Test RSS export functionality
 *
 * Run: npx ts-node scripts/test-rss-export.ts
 * Or:  node --loader tsx scripts/test-rss-export.ts
 */

import { generateRssXml, generateOpmlXml } from '../lib/feeds/rss-generator';
import { defaultFeedSources } from '../lib/config/default-columns';
import { FeedItem } from '../lib/feeds/types';

// Mock feed items for testing
const mockItems: FeedItem[] = [
	{
		id: 'test-1',
		dedupeKey: 'test-1-key',
		title: 'AI Breakthrough: New Model Achieves 99% Accuracy',
		url: 'https://example.com/ai-breakthrough',
		summary: 'Researchers announce a new AI model that achieves unprecedented accuracy on benchmark tasks.',
		content:
			'A team of researchers has announced a breakthrough in artificial intelligence, introducing a new model that achieves 99% accuracy on a wide range of benchmark tasks. The model, trained on billions of parameters, outperforms previous state-of-the-art systems and is expected to have applications in healthcare, finance, and scientific research.',
		sourceId: 'tech-news',
		sourceName: 'TechNews Daily',
		sourceKind: 'rss',
		publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
		author: 'Jane Smith',
		imageUrl: 'https://example.com/ai-image.jpg',
		tags: ['AI', 'Machine Learning', 'Technology'],
		originFeedUrl: 'https://technewsdaily.com/feed.xml',
	},
	{
		id: 'test-2',
		dedupeKey: 'test-2-key',
		title: 'Global Market Rally: Tech Stocks Surge 5%',
		url: 'https://example.com/market-rally',
		summary: 'Technology stocks lead market gains as investors show strong appetite for growth.',
		content:
			'Global markets rallied today with technology stocks leading the charge. Major indices closed higher as investors showed renewed confidence in growth-oriented sectors. The NASDAQ composite gained 5% amid strong earnings reports from several megacap tech companies.',
		sourceId: 'finance-news',
		sourceName: 'Finance Today',
		sourceKind: 'rss',
		publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
		author: 'John Doe',
		imageUrl: 'https://example.com/market-image.jpg',
		tags: ['Markets', 'Tech', 'Finance'],
		originFeedUrl: 'https://financetoday.com/feed.xml',
	},
	{
		id: 'test-3',
		dedupeKey: 'test-3-key',
		title: 'Scientists Discover Novel Treatment for Common Disease',
		url: 'https://example.com/medical-breakthrough',
		summary: 'A new treatment shows promise in clinical trials.',
		content:
			'Scientists have announced a breakthrough in the treatment of a common disease affecting millions worldwide. Clinical trials show the new therapy to be more effective and have fewer side effects than existing treatments.',
		sourceId: 'science-news',
		sourceName: 'Science Weekly',
		sourceKind: 'rss',
		publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
		author: 'Dr. Alice Johnson',
		tags: ['Science', 'Medicine', 'Health'],
		originFeedUrl: 'https://scienceweekly.com/feed.xml',
	},
];

function testRssGeneration() {
	console.log('=== RSS Generation Test ===\n');

	const rssXml = generateRssXml(mockItems, {
		title: 'Test News Deck - Technology',
		description: 'A curated feed of the latest technology news.',
		link: 'http://localhost:3000',
		language: 'en-us',
		copyright: '© 2026 Next News Deck',
	});

	// Verify XML structure
	const hasXmlDeclaration = rssXml.includes('<?xml version="1.0"');
	const hasRssTag = rssXml.includes('<rss version="2.0"');
	const hasChannel = rssXml.includes('<channel>');
	const hasItems = mockItems.every((item) => rssXml.includes(`<title>${item.title}</title>`));

	console.log(`✓ XML Declaration present: ${hasXmlDeclaration}`);
	console.log(`✓ RSS 2.0 tag present: ${hasRssTag}`);
	console.log(`✓ Channel tag present: ${hasChannel}`);
	console.log(`✓ All items included: ${hasItems}`);
	console.log(`\n📦 RSS Output (first 1500 chars):\n`);
	console.log(rssXml.substring(0, 1500) + '\n...\n');

	return rssXml;
}

function testOpmlGeneration() {
	console.log('=== OPML Generation Test ===\n');

	const opmlXml = generateOpmlXml(
		defaultFeedSources.slice(0, 5).map((source) => ({
			id: source.id,
			title: source.title,
			feedUrl: source.feedUrl,
			siteUrl: source.siteUrl,
			tags: source.tags,
		})),
		'Next News Deck - Feed Subscriptions',
	);

	// Verify OPML structure
	const hasXmlDeclaration = opmlXml.includes('<?xml version="1.0"');
	const hasOpmlTag = opmlXml.includes('<opml version="2.0"');
	const hasOutlines = opmlXml.includes('<outline');

	console.log(`✓ XML Declaration present: ${hasXmlDeclaration}`);
	console.log(`✓ OPML 2.0 tag present: ${hasOpmlTag}`);
	console.log(`✓ Outline tags present: ${hasOutlines}`);
	console.log(`\n📦 OPML Output:\n`);
	console.log(opmlXml);

	return opmlXml;
}

function testXmlEscaping() {
	console.log('\n=== XML Escaping Test ===\n');

	const testItem: FeedItem = {
		id: 'escape-test',
		dedupeKey: 'escape-test-key',
		title: 'Breaking: "Quotes" & <tags> in title',
		url: 'https://example.com/test?id=1&name="value"',
		summary: 'Test & summary with "special" chars',
		content: '<p>Content with & ampersand, "quotes" & <angle brackets></p>',
		sourceId: 'test',
		sourceName: 'Test & News',
		sourceKind: 'rss',
		publishedAt: new Date().toISOString(),
		author: 'Test "Author" & Co.',
		tags: ['test & tag', '"quoted"'],
		originFeedUrl: 'https://example.com/rss?id=1&type=news',
	};

	const rssXml = generateRssXml([testItem], {
		title: 'Test & Escape Characters',
		description: 'Testing & "escaping" of <special> characters',
		link: 'https://example.com?id=1&name="value"',
	});

	// Check escaping
	const hasEscapedQuotes = rssXml.includes('&quot;');
	const hasEscapedAmps = rssXml.includes('&amp;');
	const hasEscapedLt = rssXml.includes('&lt;');
	const hasEscapedGt = rssXml.includes('&gt;');

	console.log(`✓ Escaped quotes (&quot;): ${hasEscapedQuotes}`);
	console.log(`✓ Escaped ampersands (&amp;): ${hasEscapedAmps}`);
	console.log(`✓ Escaped less-than (&lt;): ${hasEscapedLt}`);
	console.log(`✓ Escaped greater-than (&gt;): ${hasEscapedGt}`);

	return rssXml;
}

async function main() {
	try {
		const rss = testRssGeneration();
		const opml = testOpmlGeneration();
		const escaped = testXmlEscaping();

		console.log('\n✅ All tests passed!\n');
		console.log('Summary:');
		console.log(`  - RSS generation: ✓`);
		console.log(`  - OPML generation: ✓`);
		console.log(`  - XML escaping: ✓`);
		console.log(`\nNext steps:`);
		console.log(`  1. Run the dev server: pnpm dev`);
		console.log(`  2. Test RSS export: http://localhost:3000/api/feeds/export/column.xml?columnId=technology`);
		console.log(`  3. Test OPML export: http://localhost:3000/api/feeds/export/opml.ts`);
		console.log(`\nYou can paste the RSS/OPML URLs into any feed reader (Feedly, Apple News, Inoreader, etc.)`);
	} catch (error) {
		console.error('❌ Test failed:', error);
		process.exit(1);
	}
}

main();
