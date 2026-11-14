export const ABOUT_HIGHLIGHT_LIMIT = 6;
export const ABOUT_ME_WORK_COUNT = 9;

/** @typedef {{label: string, title: string, description: string, period: string, url: string}} AboutHighlight */
/** @typedef {{label: string, libraryId: string}} AboutMeWork */

/** Return fresh placeholder records so callers never share mutable defaults. */
function defaultAboutHighlights() {
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

/** Preserve slot positions, including empty or removed Library references. @param {unknown} value @returns {AboutMeWork[]} */
function readableAboutMeWorks(value) {
  const rows = Array.isArray(value) ? value : [];
  return Array.from({ length: ABOUT_ME_WORK_COUNT }, (_, index) => {
    const item = rows[index];
    const text = key => typeof item?.[key] === 'string' ? item[key].trim().slice(0, 80) : '';
    return { label: text('label'), libraryId: text('libraryId') };
  });
}

/**
 * Defaults for older content volumes. An absent introduction reuses the site's
 * own text; an absent launch time never invents a date or a running-time claim.
 * @param {{intro?: unknown, orbitImage?: unknown, aboutEyebrow?: unknown, aboutTitle?: unknown, aboutBody?: unknown, aboutHighlights?: unknown, aboutMeTitle?: unknown, aboutMeSubtitle?: unknown, aboutMeWorks?: unknown, contactEyebrow?: unknown, contactTitle?: unknown, contactBody?: unknown, launchedAt?: unknown}} value
 */
export function homeSettings(value) {
  return {
    orbitImage: typeof value.orbitImage === 'string' ? value.orbitImage : '',
    aboutEyebrow: typeof value.aboutEyebrow === 'string' ? value.aboutEyebrow : 'Enter about label',
    aboutTitle: typeof value.aboutTitle === 'string' ? value.aboutTitle : 'Enter about title',
    aboutBody: typeof value.aboutBody === 'string' ? value.aboutBody : typeof value.intro === 'string' ? value.intro : 'Enter about content',
    aboutHighlights: readableHighlights(value.aboutHighlights),
    aboutMeTitle: typeof value.aboutMeTitle === 'string' ? value.aboutMeTitle : 'About me',
    aboutMeSubtitle: typeof value.aboutMeSubtitle === 'string' ? value.aboutMeSubtitle : '构成我的九部作品',
    aboutMeWorks: readableAboutMeWorks(value.aboutMeWorks),
    contactEyebrow: typeof value.contactEyebrow === 'string' ? value.contactEyebrow : 'Enter contact label',
    contactTitle: typeof value.contactTitle === 'string' ? value.contactTitle : 'Enter contact title',
    contactBody: typeof value.contactBody === 'string' ? value.contactBody : 'Enter contact content',
    launchedAt: typeof value.launchedAt === 'string' ? value.launchedAt : '',
  };
}
