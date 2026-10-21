import items from '../content/library.json';
import { normalizeLibraryTypeId } from '../../lib/library-settings.mjs';
import { site } from './site';

export type LibraryType = string;

/** Managed through the local content studio. Demo entries are explicitly labelled. */
export interface LibraryItem {
  id: string;
  title: string;
  original: string;
  type: LibraryType;
  typeLabel: string;
  categoryLabel: string;
  creator: string;
  date: string;
  rating: string;
  cover: string;
  note: string;
  detail: string;
  article: string | null;
  tags: string[];
  demo: boolean;
}

export const libraryTypes = site.libraryTypes;

export const library: LibraryItem[] = (items as Omit<LibraryItem, 'categoryLabel'>[]).map(item => {
  const type = normalizeLibraryTypeId(item.type);
  return { ...item, type, categoryLabel: libraryTypes.find(category => category.id === type)?.label || item.typeLabel || type };
});
