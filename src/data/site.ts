import settings from '../content/site.json';
import { homeSettings, resolveFriendApplicationsEnabled } from '../../lib/home-settings.mjs';
import { librarySettings } from '../../lib/library-settings.mjs';

export type NavigationId = 'home' | 'blog' | 'library' | 'friends';
export type DefaultTheme = 'system' | 'light' | 'dark';
export interface SiteCategory { id: string; label: string; en: string; }
export interface AboutHighlight { label: string; title: string; description: string; period: string; url: string; }
export interface AboutMeWork { label: string; libraryId: string; }
export interface SiteSettings {
  name: string; title: string; description: string; url: string;
  tagline: string; intro: string; eyebrow: string; footerNote: string; footerLabel: string;
  github: string; email: string; logo: string; favicon: string; orbitImage: string; defaultTheme: DefaultTheme;
  showRSS: boolean; demo: boolean; archiveSubtitle: string; archiveTitle: string; homeEdition: string;
  aboutEyebrow: string; aboutTitle: string; aboutBody: string;
  aboutHighlights: AboutHighlight[];
  aboutMeTitle: string; aboutMeSubtitle: string; aboutMeWorks: AboutMeWork[];
  contactEyebrow: string; contactTitle: string; contactBody: string; launchedAt: string;
  friendApplicationsEnabled?: boolean;
  navigation: Array<{ id: NavigationId; label: string; visible: boolean }>;
  pages: Record<'blog' | 'library' | 'friends', { title: string }>;
  categories: SiteCategory[];
  libraryTypes: SiteCategory[];
}

const navigationPaths: Record<NavigationId, string> = {
  home: '/', blog: '/blog/', library: '/library/', friends: '/friends/',
};
const configured = settings as SiteSettings;

const envFriendApplications = (import.meta.env as Record<string, string | undefined> | undefined)?.PUBLIC_FRIEND_APPLICATIONS
  ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PUBLIC_FRIEND_APPLICATIONS;
const home = homeSettings(configured);

/** Editable content stays in JSON; route paths remain under application control. */
export const site = {
  ...configured,
  ...home,
  ...librarySettings(configured),
  friendApplicationsEnabled: resolveFriendApplicationsEnabled(home.friendApplicationsEnabled, envFriendApplications),
  navigation: configured.navigation
    .filter(item => item.visible && Object.hasOwn(navigationPaths, item.id))
    .map(item => ({ ...item, href: navigationPaths[item.id] })),
};

/** Production site settings take precedence over a local preview's origin. */
export function siteBaseURL(fallback?: URL | string): URL {
  for (const candidate of [site.url, fallback]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url;
    } catch { /* An empty or malformed hand-edited value uses the next fallback. */ }
  }
  return new URL('http://localhost:4321/');
}

/** Public assets and remote HTTP(S) images work without a build-time download. */
export function imageSource(value: string): string {
  if (/^\/(?!\/)/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : '';
  } catch { return ''; }
}
