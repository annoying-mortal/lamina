import { getCollection } from 'astro:content';
import { site, type SiteCategory } from '../data/site';
import { readPostFile, assertUniquePosts, isPostFile } from '../../lib/posts.mjs';

export const categories: SiteCategory[] = site.categories;

export async function getPosts() {
  const entries = await getCollection('blog');
  const posts = await Promise.all(entries.filter(entry => isPostFile(entry.id)).map(async (entry) => {
    // Read the original YAML with the CMS parser: Astro's timestamp coercion can
    // otherwise normalize an invalid calendar date before our validation sees it.
    const { post } = await readPostFile({
      filename: entry.id, defaultCategoryId: categories[0]?.id ?? 'uncategorized',
    });
    return { ...post, category: categories.find(category => category.id === post.categoryId)?.label ?? 'Uncategorized', sourcePath: entry.id, entry };
  }));
  assertUniquePosts(posts);
  return posts.filter(post => !post.draft).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** Older posts keep a reachable filter and archive lane after a category is removed. */
export function getPostCategories(posts: Array<{ categoryId: string; category: string }>): SiteCategory[] {
  const known = new Set(categories.map(category => category.id));
  const missing: SiteCategory[] = [];
  for (const post of posts) {
    if (known.has(post.categoryId)) continue;
    known.add(post.categoryId);
    missing.push({ id: post.categoryId, label: post.category, en: 'UNCATEGORIZED' });
  }
  return [...categories, ...missing];
}
