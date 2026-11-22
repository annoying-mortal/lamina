import type { APIRoute } from 'astro';
import { library, librarySearchText, libraryTrackHash } from '../data/library';
import { getPosts } from '../lib/content';
import { postSearchText } from '../lib/post-search';
import { normalizeSearchText } from '../lib/search-text';

async function indexEntries() {
  const posts = await getPosts();
  return [
    ...posts.map(post => ({
      kind: 'blog' as const, href: `/blog/${encodeURIComponent(post.slug)}/`, title: post.title,
      category: post.category, categoryId: `blog:${post.categoryId}`, summary: post.summary,
      text: postSearchText(post),
    })),
    ...library.map(item => ({
      kind: 'library' as const, href: `/library/#work-${encodeURIComponent(item.id)}`, title: item.title,
      category: item.categoryLabel, categoryId: `library:${item.type}`, summary: item.note || item.detail || item.original,
      text: librarySearchText(item),
    })),
    ...library.flatMap(album => (album.tracks ?? []).map(track => ({
      kind: 'track' as const, title: track.title, summary: [album.title, album.creator].filter(Boolean).join(' · '),
      href: `/library/${libraryTrackHash(album.id, track.id)}`,
      category: album.categoryLabel, categoryId: `library:${album.type}`, text: normalizeSearchText(track.title),
    }))),
  ];
}

export type SearchRecord = Awaited<ReturnType<typeof indexEntries>>[number];
export const GET: APIRoute = async () => Response.json(await indexEntries());
