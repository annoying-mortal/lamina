/* Shared by the login screen and workspace; loaded before their styles. */
(() => {
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const key = 'field-theme';
  const defaultKey = 'field-default-theme';
  const valid = value => ['light', 'dark', 'system'].includes(value);
  const stored = name => { try { return localStorage.getItem(name); } catch { return null; } };
  if (!valid(root.dataset.defaultTheme)) root.dataset.defaultTheme = valid(stored(defaultKey)) ? stored(defaultKey) : 'system';
  function read() {
    const manual = stored(key);
    if (manual === 'light' || manual === 'dark') return manual;
    return root.dataset.defaultTheme === 'light' || root.dataset.defaultTheme === 'dark' ? root.dataset.defaultTheme : system.matches ? 'dark' : 'light';
  }
  function apply(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#11181b' : '#eae5e1');
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const chinese = stored('admin-locale') === 'zh';
      const label = theme === 'dark' ? (chinese ? '切换到浅色模式' : 'Switch to light mode') : (chinese ? '切换到深色模式' : 'Switch to dark mode');
      button.setAttribute('aria-label', label); button.setAttribute('title', label);
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.querySelector('[data-theme-label]')?.remove();
    });
    window.dispatchEvent(new CustomEvent('blog:theme', { detail: { theme } }));
    return theme;
  }
  function setDefault(theme) {
    if (!valid(theme)) return;
    root.dataset.defaultTheme = theme;
    try { localStorage.setItem(defaultKey, theme); } catch {}
    apply(read());
  }
  function refresh() { return apply(read()); }
  window.FieldTheme = Object.freeze({ setDefault, refresh, read });
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-theme-toggle]')) return;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(key, next); } catch {}
    apply(next);
  });
  system.addEventListener('change', refresh);
  window.addEventListener('admin:language-change', refresh);
  window.addEventListener('storage', event => { if (event.key === key || event.key === defaultKey || event.key === 'admin-locale') { if (event.key === defaultKey && valid(event.newValue)) root.dataset.defaultTheme = event.newValue; refresh(); } });
  document.addEventListener('DOMContentLoaded', refresh, { once: true });
  refresh();
})();
