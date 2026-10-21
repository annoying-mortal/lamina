import { siteRuntime } from '../../lib/site-runtime.mjs';

let cleanup: (() => void) | undefined;
let current: HTMLElement | null = null;
function initHome() {
  const hero = document.querySelector<HTMLElement>('.home-hero');
  if (hero && current === hero) return;
  cleanup?.(); current = hero;
  if (!hero) return;
  const events = new AbortController();
  const content = hero.querySelector<HTMLElement>('.hero-content')!;
  const orbit = document.querySelector<HTMLElement>('[data-home-orbit]')!;
  const orbitPosition = orbit.querySelector<HTMLElement>('.home-orbit-position')!;
  const orbitImage = orbit.querySelector<HTMLImageElement>('[data-orbit-image]');
  if (orbitImage) {
    orbitImage.addEventListener('error', () => { orbitImage.hidden = true; }, { once: true, signal: events.signal });
    if (orbitImage.complete && !orbitImage.naturalWidth) orbitImage.hidden = true;
  }
  const hourMarker = orbit.querySelector<SVGPathElement>('[data-orbit-hour-marker]')!;
  const minuteMarker = orbit.querySelector<SVGPathElement>('[data-orbit-minute-marker]')!;
  const orbitAnchor = hero.querySelector<HTMLElement>('.hero-art-anchor')!;
  const archive = document.querySelector<HTMLElement>('#archives')!;
  const header = document.querySelector<HTMLElement>('.site-header')!;
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.scene-nav a')];
  const sections = links.map(link => document.getElementById(link.hash.slice(1))!);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let heroTop = 0;
  let heroHeight = 1;
  let viewportWidth = innerWidth;
  let viewportHeight = innerHeight;
  let sectionTops: number[] = [];
  let orbitSize = 420;
  let orbitX = 0;
  let orbitY = 0;
  let orbitEndSize = 1000;
  let clockTimer: number | undefined;
  const updateOrbitTime = () => {
    if (clockTimer !== undefined) window.clearTimeout(clockTimer);
    clockTimer = undefined;
    if (document.hidden) return;
    // Keep the dial fixed; only the two bold ticks indicate the local time.
    const now = new Date();
    const hour = now.getHours() % 12;
    const minute = now.getMinutes();
    hourMarker.setAttribute('transform', `rotate(${hour * 30 + minute * .5} 210 210)`);
    minuteMarker.setAttribute('transform', `rotate(${minute * 6} 210 210)`);
    const time = `${hour || 12}:${String(minute).padStart(2, '0')} ${now.getHours() < 12 ? 'AM' : 'PM'}`;
    orbit.setAttribute('aria-label', `Local time ${time}, 12-hour dial`);
    orbit.setAttribute('aria-hidden', String(orbit.dataset.obscured === 'true'));
    orbit.dataset.clockReady = '';
    // Align to the next minute. No animation loop or hidden-tab timer is needed.
    clockTimer = window.setTimeout(updateOrbitTime, 60000 - (Date.now() % 60000) + 20);
  };
  // Geometry changes only with layout. Scrolling updates compositor transforms;
  // CSS owns the continuous rotation, so there is no perpetual JavaScript loop.
  const measure = () => {
    const bounds = hero.getBoundingClientRect();
    heroTop = bounds.top + window.scrollY;
    heroHeight = Math.max(1, bounds.height);
    viewportWidth = innerWidth;
    viewportHeight = innerHeight;
    sectionTops = sections.map(section => section.getBoundingClientRect().top + window.scrollY);
    const anchor = orbitAnchor.getBoundingClientRect();
    orbitSize = Math.max(1, anchor.width * .88);
    orbitX = anchor.left + anchor.width / 2;
    orbitY = anchor.top + window.scrollY - heroTop + anchor.height / 2;
    orbitEndSize = viewportWidth <= 760
      ? Math.min(viewportWidth * 2, viewportHeight * 1.1)
      : Math.max(viewportWidth * .92, viewportHeight * 1.2, orbitSize * 2.4);
    orbitPosition.style.setProperty('--orbit-size', `${orbitSize}px`);
  };
  const update = () => {
    frame = 0;
    const progress = Math.min(1, Math.max(0, (window.scrollY - heroTop) / heroHeight));
    const activeChapter = sectionTops.reduce((active, top, index) => top <= window.scrollY + viewportHeight * .5 ? index : active, 0);
    const isArchive = sections[activeChapter] === archive;
    const hideHeader = window.scrollY > 45;
    header.classList.toggle('header-hidden', hideHeader);
    header.inert = hideHeader;
    header.setAttribute('aria-hidden', String(hideHeader));
    document.documentElement.classList.toggle('in-archive', isArchive);
    links.forEach((link, index) => {
      link.classList.toggle('is-active', index === activeChapter);
      if (index === activeChapter) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    content.style.transform = reduced.matches ? '' : `translateY(${progress * 70}px)`;
    content.style.opacity = reduced.matches ? '' : String(1 - progress * .8);
    const travel = reduced.matches ? Number(progress >= .5) : progress * progress * (3 - 2 * progress);
    const diameter = orbitSize + (orbitEndSize - orbitSize) * travel;
    const centerX = orbitX + (viewportWidth - orbitX) * travel;
    const centerY = orbitY + (viewportHeight - orbitY) * travel;
    orbitPosition.style.transform = `translate3d(${centerX - diameter / 2}px,${centerY - diameter / 2}px,0) scale(${diameter / orbitSize})`;
    orbit.style.setProperty('--orbit-opacity', String(.58 - travel * .32));
    orbit.style.setProperty('--orbit-image-opacity', String(1 - Math.min(1, travel * 2)));
    orbit.dataset.obscured = String(isArchive);
    orbit.setAttribute('aria-hidden', String(isArchive));
    orbit.dataset.motion = document.hidden || reduced.matches ? 'paused' : 'running';
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const resize = () => { measure(); schedule(); };
  window.addEventListener('scroll', schedule, { passive: true, signal: events.signal });
  window.addEventListener('resize', resize, { passive: true, signal: events.signal });
  reduced.addEventListener('change', schedule, { signal: events.signal });
  const observer = new ResizeObserver(resize);
  observer.observe(hero);
  sections.forEach(section => observer.observe(section));
  observer.observe(orbitAnchor);
  // Page keys move between chapters; arrow keys remain the archive's controls.
  document.addEventListener('keydown', event => {
    if (!['PageDown', 'PageUp'].includes(event.key) || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input,textarea,select,[contenteditable="true"],dialog,[role="dialog"],#archive-preview-content') || document.querySelector('dialog[open],.primary-nav.nav-open')) return;
    const index = links.findIndex(link => link.getAttribute('aria-current') === 'location');
    const nextIndex = index + (event.key === 'PageDown' ? 1 : -1);
    if (index < 0 || nextIndex < 0 || nextIndex >= sections.length) return;
    const next = sections[nextIndex];
    // Long mobile chapters retain native scrolling until their content is read.
    const bounds = sections[index].getBoundingClientRect();
    if (event.key === 'PageDown' ? bounds.bottom > innerHeight + 2 : bounds.top < -2) return;
    event.preventDefault();
    next.scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'start' });
  }, { signal: events.signal });
  const runtime = document.querySelector<HTMLElement>('[data-launched-at]');
  const updateRuntime = () => {
    if (!runtime || document.hidden) return;
    const value = siteRuntime(runtime.dataset.launchedAt!);
    if (!value) return;
    const days = runtime.querySelector<HTMLElement>('[data-runtime-days]')!;
    const clock = runtime.querySelector<HTMLElement>('[data-runtime-clock]')!;
    days.textContent = String(value.days);
    clock.textContent = value.pending ? 'Not launched yet' : `${String(value.hours).padStart(2, '0')}h ${String(value.minutes).padStart(2, '0')}m ${String(value.seconds).padStart(2, '0')}s`;
  };
  updateRuntime();
  const timer = runtime ? window.setInterval(updateRuntime, 1000) : undefined;
  document.addEventListener('visibilitychange', () => {
    updateRuntime();
    updateOrbitTime();
    orbit.dataset.motion = document.hidden || reduced.matches ? 'paused' : 'running';
    if (!document.hidden) schedule();
  }, { signal: events.signal });
  window.addEventListener('pageshow', () => { resize(); updateOrbitTime(); }, { signal: events.signal });
  updateOrbitTime();
  measure();
  update();
  cleanup = () => {
    events.abort(); observer.disconnect(); if (frame) cancelAnimationFrame(frame); if (timer !== undefined) clearInterval(timer); current = null;
    if (clockTimer !== undefined) window.clearTimeout(clockTimer);
    header.classList.remove('header-hidden'); header.inert = false; header.removeAttribute('aria-hidden');
    document.documentElement.classList.remove('in-archive');
  };
}
const beforeSwap = () => { cleanup?.(); cleanup = undefined; };
document.addEventListener('astro:page-load', initHome);
document.addEventListener('astro:before-swap', beforeSwap);
if (import.meta.hot) import.meta.hot.dispose(() => {
  beforeSwap();
  document.removeEventListener('astro:page-load', initHome);
  document.removeEventListener('astro:before-swap', beforeSwap);
});
initHome();
