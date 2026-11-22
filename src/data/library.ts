import items from '../content/library.json';
import { normalizeSearchText } from '../lib/search-text';
import { normalizeLibraryTypeId } from '../../lib/library-settings.mjs';
import { imageSource, site } from './site';
import { albumTracks } from '../../lib/album-tracks.mjs';

export type LibraryType = string;
export interface AlbumTrack { id: string; title: string; src: string }
export interface MusicAlbum { id: string; title: string; creator: string; cover: string; tracks: AlbumTrack[] }

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
  tracks?: AlbumTrack[];
}

export const libraryTypes = site.libraryTypes;

export function libraryTrackHash(albumId: string, trackId: string) {
  return `#work-${encodeURIComponent(albumId)}/track/${encodeURIComponent(trackId)}`;
}

export function librarySearchText(item: LibraryItem) {
  const fields = [item.title, item.original, item.creator, item.categoryLabel, item.typeLabel, item.note, item.detail, ...(item.tags ?? [])];
  return normalizeSearchText(fields.join(' '));
}

export const library: LibraryItem[] = (items as Omit<LibraryItem, 'categoryLabel'>[]).map(item => {
  const type = normalizeLibraryTypeId(item.type);
  return { ...item, type, tracks: albumTracks(item.tracks, type, { skipRepeatedAudio: true }), categoryLabel: libraryTypes.find(category => category.id === type)?.label || item.typeLabel || type };
});

export const musicAlbums: MusicAlbum[] = library.flatMap(({ id, title, creator, cover, tracks }) =>
  tracks?.length ? [{ id, title, creator, cover: imageSource(cover), tracks }] : []);
