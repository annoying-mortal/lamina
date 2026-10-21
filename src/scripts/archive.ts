import {
  configureArchive, records, archiveColumns, categoryRecords, columnFiles,
  fileLocation, type ArchiveData,
} from '../archive/data';
import { wrap, type ArchiveCell, type ArchiveNavigation } from '../archive/archive-loop';
import type { ArchiveScene } from '../archive/scene';
import { fullMotion, reducedMotion } from '../archive/motion-preferences';

const STORAGE_KEY = 'field-notes:archive';
let teardown: (() => void) | undefined;
let currentSection: HTMLElement | undefined;

/** One archive instance belongs to one Home page DOM, including Astro swaps. */
function initArchive() {
  const section = document.querySelector<HTMLElement>('#archives');
  if (section && currentSection === section) return;
  teardown?.();
  teardown = undefined;
  currentSection = undefined;
  if (!section) return;
  // ArchiveSection renders these nodes and serializes the collection together.
  const container = section.querySelector<HTMLElement>('#archive-canvas')!;
  const dataElement = section.querySelector<HTMLScriptElement>('#archive-data')!;
  let data: ArchiveData;
  try { data = JSON.parse(dataElement.textContent!) as ArchiveData; }
  catch { return; }
  if (!data.posts.length) return;
  configureArchive(data);
  if (!archiveColumns.length) return;
  currentSection = section;

  const events = new AbortController();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const open = section.querySelector<HTMLButtonElement>('#archive-open')!;
  const read = section.querySelector<HTMLAnchorElement>('#archive-read')!;
  const selection = section.querySelector<HTMLElement>('#archive-selection')!;
  const preview = section.querySelector<HTMLElement>('#archive-preview')!;
  const back = section.querySelector<HTMLButtonElement>('#archive-back')!;
  const status = section.querySelector<HTMLElement>('#archive-status')!;
  const categoriesHost = section.querySelector<HTMLElement>('#archive-categories')!;
  const cover = section.querySelector<HTMLImageElement>('#archive-preview-cover')!;
  const ratingRow = section.querySelector<HTMLElement>('#archive-preview-rating-row')!;
  const original = section.querySelector<HTMLElement>('#archive-preview-original')!;
  const ticks = section.querySelector('#archive-ticks')!;
  const previewContent = section.querySelector<HTMLElement>('#archive-preview-content')!;
  cover.addEventListener('error', () => { cover.hidden = true; }, { signal: events.signal });
  let scene: ArchiveScene | undefined;
  let destroyed = false;
  let loading = false;
  let visible = false;
  let frame = 0;
  let mode: 'archive' | 'detail' = 'archive';
  let selected = 0;
  const memory: Record<string, string> = {};
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.memory && typeof saved.memory === 'object') Object.assign(memory, saved.memory);
    selected = Math.max(0, records.findIndex(post => post.id === saved.id));
  } catch { /* Private browsing and storage limits do not block browsing. */ }

  const save = () => {
    const post = records[selected];
    memory[post.categoryId] = post.id;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id: post.id, memory })); } catch {}
  };
  const text = (id: string, value: string, animate = false) => {
    const element = section.querySelector<HTMLElement>(`#${id}`)!;
    if (element.textContent === value) return;
    element.textContent = value;
    if (animate && !reduced.matches) {
      element.getAnimations().forEach(animation => animation.cancel());
      element.animate([{ opacity: .35, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], {
        duration: 220, easing: 'cubic-bezier(.2,.7,.3,1)',
      });
    }
  };
  const categoryButtons = new Map<string, HTMLButtonElement>();
  categoriesHost.replaceChildren();
  categoryRecords.forEach((category, lane) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'archive-category-button';
    button.dataset.category = category.id;
    const label = document.createElement('span');
    label.textContent = category.label;
    const count = document.createElement('small');
    count.textContent = String(columnFiles(lane).length).padStart(2, '0');
    button.append(label, count);
    button.addEventListener('click', () => chooseCategory(lane), { signal: events.signal });
    categoryButtons.set(category.id, button);
    categoriesHost.append(button);
  });

  const refresh = (animate = false) => {
    const post = records[selected];
    const isLibrary = post.kind === 'library';
    const { lane } = fileLocation(selected);
    const category = categoryRecords[lane];
    const files = columnFiles(lane);
    const number = String(files.indexOf(selected) + 1).padStart(2, '0');
    const total = String(files.length).padStart(2, '0');
    const code = String(selected + 1).padStart(3, '0');
    const fileCode = `${isLibrary ? 'L' : 'B'}-${code}`;
    text('archive-category', category.label, animate);
    text('archive-category-name', category.label, animate);
    text('archive-file-code', fileCode, animate);
    text('archive-title', post.title, animate);
    text('archive-summary', post.summary);
    text('archive-date', isLibrary
      ? [post.creator || 'Unknown creator', post.date].filter(Boolean).join(' · ')
      : `${post.date} · ${post.readTime} MIN READ`);
    text('archive-kind', isLibrary ? 'LIBRARY / COLLECTION' : 'BLOG / ARTICLE');
    text('archive-count', `${number} / ${total}`);
    text('archive-number', number);
    text('archive-total', total);
    text('archive-category-count', `${String(lane + 1).padStart(2, '0')} / ${String(archiveColumns.length).padStart(2, '0')}`);
    text('archive-object-code', `NO.${code}`);
    text('archive-preview-code', `FILE ${fileCode}`);
    text('archive-preview-kind', isLibrary ? 'COLLECTION PREVIEW' : 'ARTICLE PREVIEW');
    text('archive-preview-title', post.title);
    text('archive-preview-category', category.label);
    text('archive-preview-category-label', isLibrary ? 'TYPE' : 'CATEGORY');
    text('archive-preview-category-value', post.category);
    text('archive-preview-label', isLibrary ? (post.demo ? 'Demo' : 'PERSONAL COLLECTION') : 'BLOG / ARTICLE');
    text('archive-preview-date-label', isLibrary ? 'ADDED' : 'PUBLISHED');
    text('archive-preview-date', post.date || '—');
    text('archive-preview-tags', post.tags.join(' · ') || '—');
    text('archive-preview-reading-label', isLibrary ? 'CREATOR' : 'READING');
    text('archive-preview-readtime', isLibrary ? (post.creator || '—') : `${post.readTime} min`);
    text('archive-preview-rating', post.rating ? `${post.rating} / 10${post.demo ? ' · Demo rating' : ''}` : 'Unrated');
    ratingRow.hidden = !isLibrary;
    text('archive-preview-original', post.original || '');
    original.hidden = !isLibrary || !post.original || post.original === post.title;
    cover.hidden = !isLibrary || !post.cover;
    cover.alt = `${post.title}${post.demo ? ' demo cover' : ' cover'}`;
    if (isLibrary && post.cover) {
      if (cover.getAttribute('src') !== post.cover) cover.src = post.cover;
      else if (cover.complete && cover.naturalWidth === 0) cover.hidden = true;
    } else cover.removeAttribute('src');
    text('archive-summary-label', isLibrary ? 'NOTE' : 'SUMMARY');
    text('archive-read-label', isLibrary ? 'VIEW COLLECTION' : 'READ ARTICLE');
    text('archive-preview-count', `${code} / ${String(records.length).padStart(3, '0')}`);
    read.href = post.href;
    read.setAttribute('aria-label', `${isLibrary ? 'View entry' : 'Read article'}: ${post.title}`);
    open.setAttribute('aria-label', `Preview: ${post.title}`);
    const count = Math.min(files.length, 12);
    const active = Math.min(count - 1, Math.floor(files.indexOf(selected) * count / files.length));
    ticks.replaceChildren(...Array.from({ length: count }, (_, index) => {
      const tick = document.createElement('i');
      if (index === active) tick.className = 'is-active';
      return tick;
    }));
    categoryButtons.forEach((button, id) => {
      const active = id === post.categoryId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.dataset.active = String(active);
      if (active) {
        // Preserve the document's current scroll; only reveal the selected lane inside its strip.
        if (button.offsetLeft < categoriesHost.scrollLeft) categoriesHost.scrollLeft = button.offsetLeft;
        else if (button.offsetLeft + button.offsetWidth > categoriesHost.scrollLeft + categoriesHost.clientWidth) categoriesHost.scrollLeft = button.offsetLeft + button.offsetWidth - categoriesHost.clientWidth;
        if (button.offsetTop < categoriesHost.scrollTop) categoriesHost.scrollTop = button.offsetTop;
        else if (button.offsetTop + button.offsetHeight > categoriesHost.scrollTop + categoriesHost.clientHeight) categoriesHost.scrollTop = button.offsetTop + button.offsetHeight - categoriesHost.clientHeight;
      }
    });
    section.dataset.selected = post.id;
    section.dataset.kind = post.kind;
    save();
  };
  const select = (index: number, navigation?: ArchiveNavigation) => {
    if (mode !== 'archive' || !records[index]) return;
    const changed = selected !== index;
    selected = index;
    scene?.select(index, navigation);
    refresh(changed);
  };
  function chooseCategory(lane: number, direction?: number) {
    const files = columnFiles(lane);
    const remembered = memory[archiveColumns[lane]];
    const index = files.find(index => records[index].id === remembered) ?? files[0];
    select(index, direction ? { axis: 'lane', direction } : undefined);
  }
  const navigate = (axis: 'row' | 'lane', direction: number) => {
    if (mode !== 'archive') return;
    const { lane } = fileLocation(selected);
    if (axis === 'lane') chooseCategory(wrap(lane + direction, archiveColumns.length), direction);
    else {
      const files = columnFiles(lane);
      select(files[wrap(files.indexOf(selected) + direction, files.length)], { axis: 'row', direction });
    }
  };
  const rememberHome = () => {
    save();
    // A normal article navigation can return to the same Home archive and file.
    if (location.hash !== '#archives') history.replaceState(history.state, '', `${location.pathname}${location.search}#archives`);
  };
  const detailStatus = () => records[selected].kind === 'library'
    ? 'Entry preview'
    : 'Post preview';
  const setMode = (next: typeof mode, focus = false) => {
    mode = next;
    section.dataset.mode = mode;
    selection.inert = mode !== 'archive';
    selection.setAttribute('aria-hidden', String(selection.inert));
    preview.inert = mode !== 'detail';
    preview.setAttribute('aria-hidden', String(preview.inert));
    scene?.setMode(mode);
    scene?.setInputEnabled(visible && mode === 'archive');
    if (mode === 'detail') {
      rememberHome();
      section.style.setProperty('--detail-visibility', section.dataset.scene !== 'ready' || reduced.matches ? '1' : '0');
      status.textContent = detailStatus();
      previewContent.focus({ preventScroll: true });
    } else {
      status.textContent = 'Ready';
      if (focus) open.focus({ preventScroll: true });
    }
  };
  const enter = () => {
    if (mode === 'detail') { read.click(); return; }
    setMode('detail');
  };
  const leave = () => setMode('archive', true);
  open.addEventListener('click', enter, { signal: events.signal });
  section.querySelector('#archive-extract')!.addEventListener('click', enter, { signal: events.signal });
  back.addEventListener('click', leave, { signal: events.signal });
  read.addEventListener('click', () => {
    rememberHome();
    if (records[selected].kind === 'blog') {
      try { sessionStorage.setItem('blog:from', 'home'); } catch {}
    }
  }, { signal: events.signal });
  const buttonActions: Record<string, () => void> = {
    'archive-prev': () => navigate('row', -1), 'archive-next': () => navigate('row', 1),
    'category-prev': () => navigate('lane', -1), 'category-next': () => navigate('lane', 1),
  };
  Object.entries(buttonActions).forEach(([id, action]) => section.querySelector(`#${id}`)!.addEventListener('click', action, { signal: events.signal }));
  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    const bounds = section.getBoundingClientRect();
    const centered = bounds.top <= innerHeight * .25 && bounds.bottom >= innerHeight * .75;
    if (!visible || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
      !centered || (target?.closest('a,button') && !section.contains(target)) ||
      target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],dialog[open]') ||
      document.querySelector('dialog[open], [aria-modal="true"], .primary-nav.nav-open')) return;
    // Arrow keys scroll long previews; page scrolling always remains available.
    if (mode === 'detail' && event.key.startsWith('Arrow')) return;
    const action: Record<string, () => void> = {
      ArrowLeft: () => navigate('lane', -1), ArrowRight: () => navigate('lane', 1),
      ArrowUp: () => navigate('row', -1), ArrowDown: () => navigate('row', 1),
      Enter: enter, Escape: () => { if (mode === 'detail') leave(); },
    };
    if (event.key === 'Enter' && target?.closest('a,button')) return;
    if (action[event.key]) { event.preventDefault(); action[event.key](); }
  }, { signal: events.signal });

  const render = (time: number) => {
    frame = 0;
    if (destroyed || !visible || document.hidden || !scene) return;
    scene.update(time / 1000);
    if (mode === 'detail') section.style.setProperty('--detail-visibility', String(scene.detailVisibility));
    frame = requestAnimationFrame(render);
  };
  const resume = () => {
    if (visible && !document.hidden && scene && !frame) frame = requestAnimationFrame(render);
    else if ((!visible || document.hidden) && frame) { cancelAnimationFrame(frame); frame = 0; }
  };
  const boot = async () => {
    if (destroyed || loading || scene) return;
    loading = true;
    section.dataset.scene = 'loading';
    status.textContent = 'Loading archive';
    try {
      const { ArchiveScene } = await import('../archive/scene');
      if (destroyed) return;
      scene = new ArchiveScene(container);
      scene.renderer.domElement.tabIndex = 0;
      scene.renderer.domElement.setAttribute('aria-label', '3D archive. Left and right change categories; up and down select entries. Press Enter to preview. Scroll to continue.');
      scene.renderer.domElement.style.touchAction = 'pan-y pinch-zoom';
      scene.renderer.domElement.style.display = 'block';
      scene.setMotion(reduced.matches ? reducedMotion() : fullMotion());
      scene.setTheme(document.documentElement.dataset.theme === 'dark', true);
      await scene.load();
      if (destroyed) return;
      scene.prepareSelection(selected);
      scene.setMode(mode);
      scene.setInputEnabled(visible && mode === 'archive');
      scene.resize();
      scene.onSelect = (index: number, cell?: ArchiveCell) => { if (visible) select(index, cell ? { cell } : undefined); };
      scene.update(performance.now() / 1000);
      section.dataset.scene = 'ready';
      status.textContent = mode === 'detail' ? detailStatus() : 'Ready';
      resume();
    } catch (error) {
      if (destroyed) return;
      console.warn('Archive rendering unavailable; Blog and Library navigation remains available.', error);
      scene?.dispose(); scene = undefined;
      section.dataset.scene = 'unavailable';
      section.style.setProperty('--detail-visibility', '1');
      status.textContent = '3D unavailable. Browse with the arrows.';
    }
  };
  const nearObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { void boot(); nearObserver.disconnect(); }
  }, { rootMargin: '500px' });
  const visibleObserver = new IntersectionObserver(entries => {
    const entry = entries[0];
    visible = entry.isIntersecting && entry.intersectionRatio >= .4;
    section.dataset.active = String(visible);
    scene?.setInputEnabled(visible && mode === 'archive');
    resume();
  }, { threshold: [0, .4, .6, 1] });
  const resizeObserver = new ResizeObserver(() => scene?.resize());
  nearObserver.observe(section);
  visibleObserver.observe(section);
  resizeObserver.observe(container);
  document.addEventListener('visibilitychange', resume, { signal: events.signal });
  window.addEventListener('pagehide', () => {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    scene?.setInputEnabled(false);
  }, { signal: events.signal });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    setMode('archive');
    resume();
  }, { signal: events.signal });
  window.addEventListener('blog:theme', event => {
    const theme = (event as CustomEvent<{ theme: 'light' | 'dark' }>).detail.theme;
    scene?.setTheme(theme === 'dark', reduced.matches);
  }, { signal: events.signal });
  reduced.addEventListener('change', () => scene?.setMotion(reduced.matches ? reducedMotion() : fullMotion()), { signal: events.signal });
  refresh();
  teardown = () => {
    destroyed = true;
    currentSection = undefined;
    events.abort();
    nearObserver.disconnect(); visibleObserver.disconnect(); resizeObserver.disconnect();
    if (frame) cancelAnimationFrame(frame);
    scene?.dispose();
    scene = undefined;
  };
}

document.addEventListener('astro:page-load', initArchive);
document.addEventListener('astro:before-swap', () => { teardown?.(); teardown = undefined; });
initArchive();
