import type { LibraryItem } from '../data/library';
import type { Friend } from '../data/friends';
import { DEFAULT_LIBRARY_TYPES, normalizeLibraryTypeId } from '../../lib/library-settings.mjs';

export interface ArchivePost {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  categoryId: string;
  date: string;
  tags: string[];
  readTime: number | string;
}
type ArchiveLibraryItem = Pick<LibraryItem,
  'id' | 'title' | 'original' | 'type' | 'typeLabel' | 'creator' | 'date' | 'rating' | 'cover' | 'note' | 'detail' | 'tags' | 'demo'
>;
export type ArchiveFriend = Pick<Friend, 'id' | 'name' | 'url' | 'avatar' | 'description' | 'label' | 'kind' | 'demo'> & { domain: string };
export interface ArchiveRecord extends Omit<ArchivePost, 'slug'> {
  kind: 'blog' | 'library' | 'friend';
  href: string;
  cover?: string;
  creator?: string;
  rating?: string;
  original?: string;
  demo?: boolean;
  domain?: string;
}
export interface ArchiveCategory { id: string; label: string }
type ArchiveLane = ArchiveCategory & { tabLabel: string };
export interface ArchiveData { posts: ArchiveRecord[]; categories: ArchiveLane[]; branding?: { title: string; subtitle: string } }

/** Blog categories, Library types and Friends share one scene with independent identities. */
export function createArchiveCollection(posts: ArchivePost[], categories: readonly ArchiveCategory[], library: ArchiveLibraryItem[] = [], libraryTypes: readonly ArchiveCategory[] = DEFAULT_LIBRARY_TYPES, friends: readonly ArchiveFriend[] = []): ArchiveData {
  const libraryCategories = libraryTypes.filter(category => category.id !== 'all');
  const entries: ArchiveRecord[] = [
    ...posts.map(({ id, slug, title, summary, category, categoryId, date, tags, readTime }) => ({
      id: `blog:${id}`, categoryId: `blog:${categoryId}`, title, summary, category, date, tags, readTime,
      kind: 'blog' as const, href: `/blog/${slug}/`,
    })),
    ...library.map(item => ({
      id: `library:${item.id}`, title: item.title,
      summary: item.note || item.detail || 'Enter library content',
      category: libraryCategories.find(category => category.id === normalizeLibraryTypeId(item.type))?.label || item.typeLabel, categoryId: `library:${normalizeLibraryTypeId(item.type)}`, date: item.date,
      tags: item.tags ?? [], readTime: '', kind: 'library' as const,
      href: `/library/#work-${encodeURIComponent(item.id)}`, cover: item.cover,
      creator: item.creator, rating: item.rating, original: item.original, demo: item.demo,
    })),
    ...friends.map(friend => ({
      id: `friend:${friend.id}`, title: friend.name,
      summary: friend.description, category: 'Friends', categoryId: 'friends', date: '',
      tags: [friend.kind, friend.label].filter(Boolean), readTime: '', kind: 'friend' as const,
      href: friend.url, cover: friend.avatar, domain: friend.domain, demo: friend.demo,
    })),
  ];
  const populated = new Set(entries.map(entry => entry.categoryId));
  const blogCategories = categories.filter(category => populated.has(`blog:${category.id}`));
  return {
    posts: entries,
    categories: [
      ...blogCategories.map(category => ({ id: `blog:${category.id}`, label: `Blog · ${category.label}`, tabLabel: blogCategories.length === 1 ? 'Blog' : category.label })),
      ...libraryCategories.map(category => ({ id: `library:${category.id}`, label: `Library · ${category.label}`, tabLabel: category.label })),
      { id: 'friends', label: 'Friends', tabLabel: 'Friends' },
    ].filter(category => populated.has(category.id)),
  };
}

/** Keep the initial HTML and subsequent selections consistent for every entry type. */
export function archiveRecordPresentation(record: ArchiveRecord) {
  if (record.kind === 'friend') return {
    prefix: 'F', kind: 'FRIENDS / WEBSITE',
    selectionMeta: record.domain || record.href,
    previewKind: 'WEBSITE PREVIEW', previewLabel: record.demo ? 'Demo' : 'EXTERNAL LINK',
    categoryLabel: 'WEBSITE', categoryValue: record.domain || record.href,
    dateLabel: '', readingLabel: '', readingValue: '',
    summaryLabel: 'ABOUT', readLabel: 'VISIT WEBSITE', readAction: 'Visit website in a new tab',
  };
  if (record.kind === 'library') return {
    prefix: 'L', kind: 'LIBRARY / COLLECTION',
    selectionMeta: [record.creator || 'Unknown creator', record.date].filter(Boolean).join(' · '),
    previewKind: 'COLLECTION PREVIEW', previewLabel: record.demo ? 'Demo' : 'PERSONAL COLLECTION',
    categoryLabel: 'TYPE', categoryValue: record.category, dateLabel: 'ADDED',
    readingLabel: 'CREATOR', readingValue: record.creator || '—',
    summaryLabel: 'NOTE', readLabel: 'VIEW COLLECTION', readAction: 'View entry',
  };
  return {
    prefix: 'B', kind: 'BLOG / ARTICLE',
    selectionMeta: `${record.date} · ${record.readTime} MIN READ`,
    previewKind: 'ARTICLE PREVIEW', previewLabel: 'BLOG / ARTICLE',
    categoryLabel: 'CATEGORY', categoryValue: record.category, dateLabel: 'PUBLISHED',
    readingLabel: 'READING', readingValue: `${record.readTime} min`,
    summaryLabel: 'SUMMARY', readLabel: 'READ ARTICLE', readAction: 'Read article',
  };
}

export let records: ArchiveRecord[] = [];
export let categoryRecords: ArchiveLane[] = [];
export let archiveColumns: string[] = [];
export let archiveBranding = { title: 'Enter archive title', subtitle: 'Enter archive subtitle' };
let filesByLane: number[][] = [];
/** Common repetition length preserves every column when rebasing an infinite grid. */
export let rowRebasePeriod = 0;
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;

export function configureArchive(data: ArchiveData) {
  records = data.posts;
  archiveBranding = data.branding ?? { title: 'Enter archive title', subtitle: 'Enter archive subtitle' };
  categoryRecords = data.categories;
  archiveColumns = categoryRecords.map(category => category.id);
  filesByLane = archiveColumns.map(id => records.flatMap((post, index) => post.categoryId === id ? [index] : []));
  rowRebasePeriod = filesByLane.reduce((period, files) => {
    if (!period) return 0;
    const next = period / gcd(period, files.length) * files.length;
    return Number.isSafeInteger(next) && next <= 1_000_000 ? next : 0;
  }, 1);
}

export function columnFiles(lane: number): number[] {
  return filesByLane[((lane % filesByLane.length) + filesByLane.length) % filesByLane.length] ?? [];
}
export function fileLocation(index: number) {
  const record = records[index] ?? records[0];
  const lane = Math.max(0, archiveColumns.indexOf(record.categoryId));
  const row = 12 + Math.max(0, columnFiles(lane).indexOf(index));
  return { lane, row };
}
