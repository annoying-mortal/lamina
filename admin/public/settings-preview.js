import { element, siteImageUrl } from './ui.js';
import { t } from './i18n.js';

const names = {
  home: ['Home', '首页'], about: ['About', '介绍'], archive: ['Archive', '档案'],
  contact: ['Contact', '联系'], blog: ['Blog', '文章'], library: ['Library', '收藏'], friends: ['Friends', '友链'],
};
const views = Object.keys(names);

export function mountSettingsPreview({ form, getValues, siteUrl }) {
  const fields = form.querySelector('#fields');
  const shell = element('div', 'settings-editor-body');
  const panel = element('aside', 'settings-preview');
  panel.setAttribute('aria-label', t('Settings preview', '设置预览'));
  const heading = element('div', 'settings-preview-heading');
  heading.append(element('span', '', t('Preview', '预览')));
  const controls = element('div', 'settings-preview-controls');
  const select = element('select');
  select.setAttribute('aria-label', t('Preview page', '预览页面'));
  for (const view of views) {
    const option = element('option', '', t(...names[view]));
    option.value = view;
    select.append(option);
  }
  const themeButton = element('button', 'preview-theme', '◐');
  themeButton.type = 'button';
  themeButton.setAttribute('aria-label', t('Toggle preview theme', '切换预览主题'));
  themeButton.title = themeButton.getAttribute('aria-label');
  controls.append(select, themeButton);
  heading.append(controls);
  const window = element('div', 'preview-window');
  const chrome = element('div', 'preview-browser');
  const canvas = element('div', 'preview-canvas');
  const metadata = element('div', 'preview-metadata');
  window.append(chrome, canvas);
  panel.append(heading, window, metadata);
  fields.before(shell);
  shell.append(fields, panel);
  let view = 'home';
  let manualTheme = '';
  let frame = 0;

  function update() {
    frame = 0;
    const settings = getValues();
    function text(value, fallback = '') {
      return String(value || fallback).replaceAll('{name}', String(settings.name || ''));
    }
    function logo(className = 'preview-brand') {
      const brand = element('div', className);
      const label = element('span', '', text(settings.name, 'Enter site name'));
      const url = siteImageUrl(settings.logo, siteUrl);
      if (url) {
        const image = element('img');
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        image.src = url;
        label.hidden = true;
        image.addEventListener('error', () => { image.hidden = true; label.hidden = false; }, { once: true });
        brand.append(image);
      }
      brand.append(label);
      return brand;
    }
    const selectedTheme = manualTheme || settings.defaultTheme;
    panel.dataset.previewTheme = selectedTheme === 'dark' || selectedTheme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    chrome.replaceChildren();
    const favicon = siteImageUrl(settings.favicon, siteUrl);
    if (favicon) {
      const icon = element('img');
      icon.alt = '';
      icon.src = favicon;
      icon.referrerPolicy = 'no-referrer';
      icon.addEventListener('error', () => { icon.hidden = true; }, { once: true });
      chrome.append(icon);
    }
    chrome.append(element('span', '', text(settings.title, 'Enter browser title')));
    canvas.replaceChildren();
    canvas.dataset.view = view;
    if (!['about', 'archive', 'contact'].includes(view)) {
      const header = element('div', 'preview-site-header');
      header.append(logo());
      const nav = element('div', 'preview-nav');
      for (const item of settings.navigation || []) {
        if (!item.visible) continue;
        const entry = element('span', item.id === view ? 'active' : '', item.label);
        nav.append(entry);
      }
      header.append(nav);
      canvas.append(header);
    }
    const body = element('div', 'preview-page');
    if (view === 'home') {
      const copy = element('div', 'preview-hero-copy');
      copy.append(element('small', '', text(settings.eyebrow)), element('h2', '', text(settings.tagline, 'Enter heading')), element('p', '', text(settings.intro)));
      const art = element('div', 'preview-orbit');
      art.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 3; i++) art.append(element('i'));
      const orbitImage = siteImageUrl(settings.orbitImage, siteUrl);
      if (orbitImage) {
        const image = element('img'); image.src = orbitImage; image.alt = ''; image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => { image.hidden = true; }, { once: true }); art.append(image);
      }
      body.append(copy, art);
    } else if (view === 'about') {
      body.append(element('small', '', text(settings.aboutEyebrow)), element('h2', '', text(settings.aboutTitle)), element('p', '', text(settings.aboutBody)));
      const highlights = element('div', 'preview-highlights');
      const groups = [];
      for (const highlight of settings.aboutHighlights || []) {
        const label = text(highlight.label).trim();
        let group = groups.find(group => group.label.toLocaleLowerCase() === label.toLocaleLowerCase());
        if (!group) { group = { label, items: [] }; groups.push(group); }
        group.items.push(highlight);
      }
      highlights.classList.toggle('single-group', groups.length === 1);
      for (const group of groups) {
        const section = element('div', 'preview-highlight-group');
        if (group.label) section.append(element('small', 'preview-highlight-label', `// ${group.label}`));
        const list = element('div', 'preview-highlight-list');
        for (const highlight of group.items) {
          const item = element('div', 'preview-highlight');
          const entry = element('div', 'preview-highlight-entry');
          const title = element('strong', '', text(highlight.title));
          if (highlight.url) title.append(element('span', 'preview-highlight-arrow', '↗'));
          entry.append(title);
          if (highlight.period) entry.append(element('small', 'preview-highlight-period', text(highlight.period)));
          item.append(entry);
          if (highlight.description) item.append(element('p', '', text(highlight.description)));
          list.append(item);
        }
        section.append(list);
        highlights.append(section);
      }
      if (groups.length) body.append(highlights);
    } else if (view === 'archive') {
      const brand = logo('preview-archive-brand');
      brand.append(element('small', '', text(settings.archiveSubtitle)), element('strong', '', text(settings.archiveTitle)));
      const selection = element('div', 'preview-archive-selection');
      selection.append(element('small', '', 'BLOG / LIBRARY'));
      for (const category of settings.categories || []) selection.append(element('span', '', category.label));
      for (const category of settings.libraryTypes || []) if (category.id !== 'all') selection.append(element('span', '', category.label));
      body.append(brand, selection);
    } else if (view === 'contact') {
      body.append(element('small', '', text(settings.contactEyebrow)), element('h2', '', text(settings.contactTitle)), element('p', '', text(settings.contactBody)));
      const links = element('div', 'preview-contact-links');
      if (settings.email) links.append(element('span', '', settings.email));
      if (settings.github) links.append(element('span', '', 'GitHub ↗'));
      if (settings.showRSS) links.append(element('span', '', 'RSS ↗'));
      body.append(links);
      if (settings.launchedAt && Number.isFinite(Date.parse(settings.launchedAt))) {
        const days = Math.max(0, Math.floor((Date.now() - Date.parse(settings.launchedAt)) / 86400000));
        body.append(element('p', 'preview-runtime', `${days} DAYS`));
      }
    } else {
      const page = settings.pages?.[view] || {};
      body.append(element('small', '', text(page.eyebrow)), element('h2', '', text(page.title, names[view][0])), element('p', '', text(page.description)));
      if (view === 'blog') {
        const filters = element('div', 'preview-filters');
        filters.append(element('span', '', 'All'));
        for (const category of settings.categories || []) filters.append(element('span', '', category.label));
        body.append(filters);
      } else if (view === 'library') {
        const filters = element('div', 'preview-filters');
        for (const category of settings.libraryTypes || []) filters.append(element('span', '', category.label));
        body.append(filters);
      }
    }
    canvas.append(body);
    const footer = element('div', 'preview-footer');
    footer.append(element('span', '', text(view === 'home' ? settings.homeEdition : settings.footerNote)), element('span', '', text(settings.footerLabel)));
    canvas.append(footer);
    metadata.replaceChildren(element('strong', '', text(settings.title, 'Enter browser title')), element('span', 'preview-url', settings.url || siteUrl || ''), element('p', '', text(settings.description)));
  }
  function schedule(event) {
    if (event?.target?.name === 'defaultTheme') manualTheme = '';
    if (!frame) frame = requestAnimationFrame(update);
  }
  function focus(event) {
    const name = event.target?.name || '';
    let next;
    if (name.startsWith('about')) next = 'about';
    else if (name.startsWith('contact') || name === 'launchedAt' || ['github', 'email'].includes(name)) next = 'contact';
    else if (name.startsWith('archive')) next = 'archive';
    else if (name.startsWith('pages.')) next = name.split('.')[1];
    else if (name.startsWith('category.')) next = 'blog';
    else if (name.startsWith('libraryType.')) next = 'library';
    else if (['name', 'logo', 'orbitImage', 'tagline', 'intro', 'eyebrow', 'homeEdition'].includes(name) || name.startsWith('nav')) next = 'home';
    if (next && next !== view && views.includes(next)) { view = next; select.value = view; schedule(); }
  }
  const system = matchMedia('(prefers-color-scheme: dark)');
  select.addEventListener('input', event => event.stopPropagation());
  select.addEventListener('change', event => { event.stopPropagation(); view = select.value; schedule(); });
  themeButton.addEventListener('click', () => { manualTheme = panel.dataset.previewTheme === 'dark' ? 'light' : 'dark'; schedule(); });
  fields.addEventListener('input', schedule);
  fields.addEventListener('change', schedule);
  fields.addEventListener('focusin', focus);
  system.addEventListener('change', schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(fields, { childList: true, subtree: true });
  update();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    fields.removeEventListener('input', schedule);
    fields.removeEventListener('change', schedule);
    fields.removeEventListener('focusin', focus);
    system.removeEventListener('change', schedule);
    shell.before(fields);
    shell.remove();
  };
}
