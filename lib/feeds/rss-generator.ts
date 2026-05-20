/**
 * Generate RSS 2.0 XML from FeedItem array.
 * Can be used to export dashboard columns as shareable RSS feeds.
 */

import { FeedItem } from '@/lib/feeds/types';

interface RssGeneratorConfig {
	title: string;
	description: string;
	link: string;
	language?: string;
	copyright?: string;
	managingEditor?: string;
}

/**
 * Escape XML special characters in text.
 */
function escapeXml(text: string): string {
	if (!text) return '';
	return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Format date for RSS (RFC 822).
 */
function toRfc822(isoDate: string): string {
	try {
		const date = new Date(isoDate);
		return date.toUTCString();
	} catch {
		return new Date().toUTCString();
	}
}

/**
 * Generate RSS 2.0 XML from feed items.
 */
export function generateRssXml(items: FeedItem[], config: RssGeneratorConfig): string {
	const { title, description, link, language = 'en-us', copyright = '© 2026 Next News Deck', managingEditor = 'news@newsdeck.local' } = config;

	const itemsXml = items
		.slice(0, 100) // Limit to 100 most recent items
		.map(
			(item) => `
  <item>
    <title>${escapeXml(item.title)}</title>
    <link>${escapeXml(item.url)}</link>
    <guid isPermaLink="false">${escapeXml(item.id)}</guid>
    <description>${escapeXml(item.content || item.summary)}</description>
    <author>${escapeXml(item.author || 'unknown')}</author>
    <pubDate>${toRfc822(item.publishedAt)}</pubDate>
    <source>${escapeXml(item.sourceName)}</source>
    ${item.tags.map((tag) => `    <category>${escapeXml(tag)}</category>`).join('\n')}
  </item>
`,
		)
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(link)}</link>
    <description>${escapeXml(description)}</description>
    <language>${escapeXml(language)}</language>
    <copyright>${escapeXml(copyright)}</copyright>
    <managingEditor>${escapeXml(managingEditor)}</managingEditor>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Next News Deck</generator>
${itemsXml}
  </channel>
</rss>`;
}

/**
 * Generate OPML (Outline Processor Markup Language) from feed sources.
 * Useful for sharing/importing multiple feed subscriptions.
 */
export interface OpmlFeedSource {
	id: string;
	title: string;
	feedUrl: string;
	siteUrl: string;
	tags: string[];
}

export function generateOpmlXml(sources: OpmlFeedSource[], title: string): string {
	const outlinesXml = sources
		.map(
			(source) => `
    <outline
      type="rss"
      text="${escapeXml(source.title)}"
      title="${escapeXml(source.title)}"
      xmlUrl="${escapeXml(source.feedUrl)}"
      htmlUrl="${escapeXml(source.siteUrl)}"
      tags="${escapeXml(source.tags.join(','))}"
    />
`,
		)
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXml(title)}</title>
    <dateCreated>${new Date().toISOString()}</dateCreated>
    <generator>Next News Deck</generator>
  </head>
  <body>
${outlinesXml}
  </body>
</opml>`;
}
