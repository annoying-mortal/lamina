import {
  archiveRecordPresentation, configureArchive, records, archiveColumns, categoryRecords, columnFiles,
  fileLocation, type ArchiveData,
} from '../archive/data';
import { wrap, type ArchiveCell, type ArchiveNavigation } from '../archive/archive-loop';
import type { ArchiveScene } from '../archive/scene';

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
  const dateRow = section.querySelector<HTMLElement>('#archive-preview-date-row')!;
  const readingRow = section.querySelector<HTMLElement>('#archive-preview-reading-row')!;
  const original = section.querySelector<HTMLElement>('#archive-preview-original')!;
  const ticks = section.querySelector('#archive-ticks')!;
  const previewContent = section.querySelector<HTMLElement>('#archive-preview-content')!;
  const previewBody = previewContent.querySelector<HTMLElement>('.archive-preview-body')!;
  const trackSection = section.querySelector<HTMLElement>('#archive-preview-tracks')!;
  const trackLists = new Map<string, HTMLOListElement>([...trackSection.querySelectorAll<HTMLOListElement>('[data-album-list]')]
    .map(list => [`library:${list.dataset.albumList}`, list] as const));
  let currentTracks: HTMLOListElement | undefined;
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
    button.title = category.label;
    const label = document.createElement('span');
    label.textContent = category.tabLabel;
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
    const isFriend = post.kind === 'friend';
    const presentation = archiveRecordPresentation(post);
    const { lane } = fileLocation(selected);
    const category = categoryRecords[lane];
    const files = columnFiles(lane);
    const fileIndex = files.indexOf(selected);
    const number = String(fileIndex + 1).padStart(2, '0');
    const total = String(files.length).padStart(2, '0');
    const code = String(selected + 1).padStart(3, '0');
    const fileCode = `${presentation.prefix}-${code}`;
    text('archive-category', category.label, animate);
    text('archive-category-name', category.label, animate);
    text('archive-file-code', fileCode, animate);
    text('archive-title', post.title, animate);
    if (currentTracks) currentTracks.hidden = true;
    currentTracks = trackLists.get(post.id);
    if (currentTracks) currentTracks.hidden = false;
    trackSection.hidden = !currentTracks;
    text('archive-extract-label', currentTracks ? 'View tracks' : 'Preview');
    text('archive-summary', post.summary);
    section.querySelector<HTMLElement>('.archive-abstract')!.hidden = !post.summary;
    text('archive-date', presentation.selectionMeta);
    text('archive-kind', presentation.kind);
    text('archive-count', `${number} / ${total}`);
    text('archive-number', number);
    text('archive-total', total);
    text('archive-category-count', `${String(lane + 1).padStart(2, '0')} / ${String(archiveColumns.length).padStart(2, '0')}`);
    text('archive-object-code', `NO.${code}`);
    text('archive-preview-code', `FILE ${fileCode}`);
    text('archive-preview-kind', presentation.previewKind);
    text('archive-preview-title', post.title);
    text('archive-preview-category', category.label);
    text('archive-preview-category-label', presentation.categoryLabel);
    text('archive-preview-category-value', presentation.categoryValue);
    text('archive-preview-label', presentation.previewLabel);
    text('archive-preview-date-label', presentation.dateLabel);
    text('archive-preview-date', post.date || '—');
    text('archive-preview-tags', post.tags.join(' · ') || '—');
    text('archive-preview-reading-label', presentation.readingLabel);
    text('archive-preview-readtime', presentation.readingValue);
    text('archive-preview-rating', post.rating ? `${post.rating} / 10${post.demo ? ' · Demo rating' : ''}` : 'Unrated');
    ratingRow.hidden = !isLibrary;
    dateRow.hidden = isFriend;
    readingRow.hidden = !presentation.readingValue;
    text('archive-preview-original', post.original || '');
    original.hidden = !isLibrary || !post.original || post.original === post.title;
    cover.hidden = !post.cover;
    cover.alt = `${post.title}${isFriend ? ' avatar' : post.demo ? ' demo cover' : ' cover'}`;
    cover.height = isFriend ? 84 : 112;
    if (post.cover) {
      if (cover.getAttribute('src') !== post.cover) cover.src = post.cover;
      else if (cover.complete && cover.naturalWidth === 0) cover.hidden = true;
    } else cover.removeAttribute('src');
    text('archive-summary-label', presentation.summaryLabel);
    text('archive-read-label', presentation.readLabel);
    text('archive-preview-count', `${code} / ${String(records.length).padStart(3, '0')}`);
    read.href = post.href;
    if (isFriend) {
      read.target = '_blank';
      read.rel = 'noopener noreferrer';
    } else {
      read.removeAttribute('target');
      read.removeAttribute('rel');
    }
    read.setAttribute('aria-label', `${presentation.readAction}: ${post.title}`);
    open.setAttribute('aria-label', `Preview: ${post.title}`);
    const count = Math.min(files.length, 12);
    const active = Math.min(count - 1, Math.floor(fileIndex * count / files.length));
    ticks.replaceChildren(...Array.from({ length: count }, (_, index) => {
      const tick = document.createElement('i');
      if (index === active) tick.className = 'is-active';
      return tick;
    }));
    categoryButtons.forEach((button, id) => {
      const active = id === post.categoryId;
      button.setAttribute('aria-pressed', String(active));
      if (active) {
        // Preserve the document's current scroll; only reveal the selected lane inside its strip.
        if (button.offsetLeft < categoriesHost.scrollLeft) categoriesHost.scrollLeft = button.offsetLeft;
        else if (button.offsetLeft + button.offsetWidth > categoriesHost.scrollLeft + categoriesHost.clientWidth) categoriesHost.scrollLeft = button.offsetLeft + button.offsetWidth - categoriesHost.clientWidth;
        if (button.offsetTop < categoriesHost.scrollTop) categoriesHost.scrollTop = button.offsetTop;
        else if (button.offsetTop + button.offsetHeight > categoriesHost.scrollTop + categoriesHost.clientHeight) categoriesHost.scrollTop = button.offsetTop + button.offsetHeight - categoriesHost.clientHeight;
      }
    });
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
  const detailStatus = () => ({ blog: 'Post preview', library: 'Entry preview', friend: 'Website preview' })[records[selected].kind];
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
      if (records[selected].kind === 'library') previewBody.scrollTop = 0;
      (records[selected].kind === 'library' ? previewBody : previewContent).focus({ preventScroll: true });
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
  const keyActions = new Map<string, () => void>([
    ['Enter', enter], ['Escape', () => { if (mode === 'detail') leave(); }],
  ]);
  for (const [id, key, axis, direction] of [
    ['archive-prev', 'ArrowUp', 'row', -1], ['archive-next', 'ArrowDown', 'row', 1],
    ['category-prev', 'ArrowLeft', 'lane', -1], ['category-next', 'ArrowRight', 'lane', 1],
  ] as const) {
    const move = () => navigate(axis, direction);
    keyActions.set(key, move);
    section.querySelector(`#${id}`)!.addEventListener('click', move, { signal: events.signal });
  }
  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    const bounds = section.getBoundingClientRect();
    const centered = bounds.top <= innerHeight * .25 && bounds.bottom >= innerHeight * .75;
    if (!visible || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
      !centered || (target?.closest('a,button') && !section.contains(target)) ||
      target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],dialog[open]') ||
      document.querySelector('dialog[open], [aria-modal="true"], .primary-nav.nav-open, #music-player:popover-open')) return;
    // Arrow keys scroll long previews; page scrolling always remains available.
    if (mode === 'detail' && event.key.startsWith('Arrow')) return;
    if (event.key === 'Enter' && target?.closest('a,button')) return;
    const action = keyActions.get(event.key);
    if (action) { event.preventDefault(); action(); }
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
      scene.setReducedMotion(reduced.matches);
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
      console.warn('Archive rendering unavailable; Blog, Library and Friends navigation remains available.', error);
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
  reduced.addEventListener('change', () => scene?.setReducedMotion(reduced.matches), { signal: events.signal });
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
