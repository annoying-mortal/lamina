type Theme = 'light' | 'dark';
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
function readTheme(): Theme {
  let value;
  try { value = localStorage.getItem('field-theme'); } catch {}
  const defaultTheme = document.documentElement.dataset.defaultTheme;
  return value === 'light' || value === 'dark' ? value : defaultTheme === 'light' || defaultTheme === 'dark' ? defaultTheme : systemTheme.matches ? 'dark' : 'light';
}
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')!.setAttribute('content', theme === 'dark' ? '#11181b' : '#eae5e1');
  document.querySelectorAll<HTMLButtonElement>('#theme-toggle, [data-theme-toggle]').forEach(button => {
    const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  });
  window.dispatchEvent(new CustomEvent('blog:theme', { detail: { theme } }));
}
document.addEventListener('click', (event) => {
  const target = event.target as Element;
  if (target.closest('#theme-toggle, [data-theme-toggle]')) {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('field-theme', theme); } catch {}
    applyTheme(theme);
  }
  const menu = target.closest<HTMLButtonElement>('.menu-toggle');
  if (menu) {
    const expanded = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(expanded));
    menu.setAttribute('aria-label', expanded ? 'Close menu' : 'Open menu');
    document.querySelector('.primary-nav')!.classList.toggle('nav-open', expanded);
  }
  if (target.closest('.primary-nav a')) closeMenu();
});
function closeMenu() {
  document.querySelector('.primary-nav')!.classList.remove('nav-open');
  const menu = document.querySelector('.menu-toggle');
  menu?.setAttribute('aria-expanded', 'false');
  menu?.setAttribute('aria-label', 'Open menu');
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
systemTheme.addEventListener('change', () => {
  if (document.documentElement.dataset.defaultTheme !== 'system') return;
  try { if (['light', 'dark'].includes(localStorage.getItem('field-theme') || '')) return; } catch {}
  applyTheme(readTheme());
});
function initializeImageFallbacks() {
  document.querySelectorAll<HTMLImageElement>('img[data-fallback-image]').forEach(image => {
    if (image.dataset.fallbackReady) return;
    image.dataset.fallbackReady = 'true';
    const hide = () => {
      image.hidden = true; image.style.display = 'none';
      const name = image.closest('[data-logo-slot]')?.querySelector<HTMLElement>('[data-logo-fallback]');
      if (name) name.hidden = false;
    };
    if (image.complete && !image.naturalWidth) hide();
    image.addEventListener('error', hide, { once: true });
  });
}
document.addEventListener('astro:after-swap', () => applyTheme(readTheme()));
document.addEventListener('astro:page-load', () => { applyTheme(readTheme()); closeMenu(); initializeImageFallbacks(); });
applyTheme(readTheme());
initializeImageFallbacks();
