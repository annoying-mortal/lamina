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
export interface ArchiveLibraryItem {
  id: string;
  title: string;
  original: string;
  type: string;
  typeLabel: string;
  creator: string;
  date: string;
  rating: string;
  cover: string;
  note: string;
  detail: string;
  tags: string[];
  demo: boolean;
}
export interface ArchiveRecord extends ArchivePost {
  kind: 'blog' | 'library';
  href: string;
  cover?: string;
  creator?: string;
  rating?: string;
  original?: string;
  demo?: boolean;
  typeLabel?: string;
}
export interface ArchiveCategory { id: string; label: string; en: string }
export interface ArchiveData { posts: ArchiveRecord[]; categories: ArchiveCategory[]; branding?: { title: string; subtitle: string } }

/** Blog categories and Library types share one scene, with independent identities. */
export function createArchiveCollection(posts: ArchivePost[], categories: readonly ArchiveCategory[], library: ArchiveLibraryItem[] = [], libraryTypes: readonly ArchiveCategory[] = DEFAULT_LIBRARY_TYPES): ArchiveData {
  const libraryCategories = libraryTypes.filter(category => category.id !== 'all');
  return {
    posts: [
      ...posts.map(post => ({
        ...post, id: `blog:${post.id}`, categoryId: `blog:${post.categoryId}`,
        kind: 'blog' as const, href: `/blog/${post.slug}/`,
      })),
      ...library.map(item => ({
        id: `library:${item.id}`, slug: item.id, title: item.title,
        summary: item.note || item.detail || 'Enter library content',
        category: libraryCategories.find(category => category.id === normalizeLibraryTypeId(item.type))?.label || item.typeLabel, categoryId: `library:${normalizeLibraryTypeId(item.type)}`, date: item.date,
        tags: item.tags ?? [], readTime: '', kind: 'library' as const,
        href: `/library/#work-${encodeURIComponent(item.id)}`, cover: item.cover,
        creator: item.creator, rating: item.rating, original: item.original, demo: item.demo,
        typeLabel: item.typeLabel,
      })),
    ],
    categories: [
      ...categories.map(category => ({ ...category, id: `blog:${category.id}`, label: `Blog · ${category.label}`, en: `BLOG / ${category.en}` })),
      ...libraryCategories.map(category => ({ ...category, id: `library:${category.id}`, label: `Library · ${category.label}`, en: `LIBRARY / ${category.en}` })),
    ],
  };
}

export let records: ArchiveRecord[] = [];
export let categoryRecords: ArchiveCategory[] = [];
export let archiveColumns: string[] = [];
export let archiveBranding = { title: 'Enter archive title', subtitle: 'Enter archive subtitle' };
let filesByLane: number[][] = [];
/** Common repetition length preserves every column when rebasing an infinite grid. */
export let rowRebasePeriod = 0;
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;

export function configureArchive(data: ArchiveData) {
  records = data.posts;
  archiveBranding = data.branding ?? { title: 'Enter archive title', subtitle: 'Enter archive subtitle' };
  categoryRecords = data.categories.filter(category => records.some(post => post.categoryId === category.id));
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
  // The stable article index replaces the old lane * 32 encoding, which broke
  // whenever a category contained more than twenty articles.
  return { lane, row, slot: index };
}
export function fileAtSlot(slot: number) { return records[slot] ? slot : 0; }
