import type { APIRoute } from 'astro';
import { getPosts } from '../lib/content';
import { site, siteBaseURL } from '../data/site';

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export const GET: APIRoute = async ({ site: siteURL }) => {
  const base = siteBaseURL(siteURL);
  const posts = await getPosts();
  const items = posts.map(post => {
    const link = new URL(`/blog/${post.slug}/`, base).href;
    return `<item><title>${xml(post.title)}</title><link>${xml(link)}</link><guid isPermaLink="true">${xml(link)}</guid><description>${xml(post.summary)}</description><pubDate>${new Date(post.date + 'T00:00:00Z').toUTCString()}</pubDate><category>${xml(post.category)}</category></item>`;
  }).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${xml(site.title)}</title><link>${xml(base.href)}</link><description>${xml(site.description)}</description><language>en</language><atom:link href="${xml(new URL('/rss.xml', base).href)}" rel="self" type="application/rss+xml"/>${items}</channel></rss>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
