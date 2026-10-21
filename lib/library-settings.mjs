/** @typedef {{id: string, label: string, en: string}} LibraryType */

export const DEFAULT_LIBRARY_TYPES = Object.freeze([
  Object.freeze({ id: 'all', label: 'All', en: 'ALL' }),
  Object.freeze({ id: 'acgn', label: 'ACGN', en: 'ACGN' }),
  Object.freeze({ id: 'albums', label: 'Albums', en: 'ALBUMS' }),
  Object.freeze({ id: 'books', label: 'Books', en: 'BOOKS' }),
  Object.freeze({ id: 'others', label: 'Others', en: 'OTHERS' }),
]);

const legacyTypes = new Map([['music', 'albums'], ['book', 'books'], ['screen', 'acgn']]);

/** Keep pre-taxonomy content readable without rewriting hand-authored files. @param {string} id */
export function normalizeLibraryTypeId(id) {
  return legacyTypes.get(id) ?? id;
}

/** Tolerant reads for hand-edited files; CMS writes validate separately. @param {unknown} value @returns {LibraryType[]} */
export function resolveLibraryTypes(value) {
  if (!Array.isArray(value)) return DEFAULT_LIBRARY_TYPES.map(item => ({ ...item }));
  const seen = new Set();
  const types = value.filter(item => item && typeof item === 'object' && !Array.isArray(item)).slice(0, 30).flatMap(item => {
    const id = typeof item.id === 'string' ? normalizeLibraryTypeId(item.id.trim()) : '';
    const label = typeof item.label === 'string' ? item.label.trim().slice(0, 60) : '';
    const en = typeof item.en === 'string' ? item.en.trim().slice(0, 100) : '';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 60 || !label || seen.has(id)) return [];
    seen.add(id);
    return [{ id, label, en }];
  });
  return types.some(item => item.id !== 'all') ? types : DEFAULT_LIBRARY_TYPES.map(item => ({ ...item }));
}

/** @param {{libraryTypes?: unknown}} value */
export function librarySettings(value) {
  return { libraryTypes: resolveLibraryTypes(value.libraryTypes) };
}
