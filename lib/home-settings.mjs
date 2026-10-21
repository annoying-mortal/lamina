export const ABOUT_HIGHLIGHT_LIMIT = 6;

/** @typedef {{label: string, title: string, description: string, period: string, url: string}} AboutHighlight */

/** Return fresh placeholder records so callers never share mutable defaults. */
export function defaultAboutHighlights() {
  return Array.from({ length: 3 }, () => ({
    label: 'Enter achievement label', title: 'Enter achievement title',
    description: 'Enter achievement summary', period: 'Enter period', url: '',
  }));
}

/** Hand-edited content is tolerant; the CMS validates writes separately. @param {unknown} value @returns {AboutHighlight[]} */
function readableHighlights(value) {
  if (!Array.isArray(value)) return defaultAboutHighlights();
  const text = (item, key, max) => typeof item[key] === 'string' ? item[key].trim().slice(0, max) : '';
  return value.filter(item => item && typeof item === 'object' && !Array.isArray(item)).slice(0, ABOUT_HIGHLIGHT_LIMIT).map(item => {
    let url = text(item, 'url', 2000);
    try { if (!/^https?:\/\//i.test(url) || /[\u0000-\u001f\u007f\\]/.test(url) || !['http:', 'https:'].includes(new URL(url).protocol)) url = ''; }
    catch { url = ''; }
    return { label: text(item, 'label', 80), title: text(item, 'title', 200), description: text(item, 'description', 500), period: text(item, 'period', 80), url };
  }).filter(item => item.title);
}

/**
 * Defaults for older content volumes. An absent introduction reuses the site's
 * own text; an absent launch time never invents a date or a running-time claim.
 * @param {{intro?: unknown, orbitImage?: unknown, aboutEyebrow?: unknown, aboutTitle?: unknown, aboutBody?: unknown, aboutHighlights?: unknown, contactEyebrow?: unknown, contactTitle?: unknown, contactBody?: unknown, launchedAt?: unknown}} value
 */
export function homeSettings(value) {
  return {
    orbitImage: typeof value.orbitImage === 'string' ? value.orbitImage : '',
    aboutEyebrow: typeof value.aboutEyebrow === 'string' ? value.aboutEyebrow : 'Enter about label',
    aboutTitle: typeof value.aboutTitle === 'string' ? value.aboutTitle : 'Enter about title',
    aboutBody: typeof value.aboutBody === 'string' ? value.aboutBody : typeof value.intro === 'string' ? value.intro : 'Enter about content',
    aboutHighlights: readableHighlights(value.aboutHighlights),
    contactEyebrow: typeof value.contactEyebrow === 'string' ? value.contactEyebrow : 'Enter contact label',
    contactTitle: typeof value.contactTitle === 'string' ? value.contactTitle : 'Enter contact title',
    contactBody: typeof value.contactBody === 'string' ? value.contactBody : 'Enter contact content',
    launchedAt: typeof value.launchedAt === 'string' ? value.launchedAt : '',
  };
}
