import { normalizeSearchText } from '../lib/search-text';
import type { SearchRecord } from '../pages/archive-search.json';

class ArchiveSearchPanel extends HTMLElement {
  private events?: AbortController;

  connectedCallback() {
    const events = this.events = new AbortController();
    const { signal } = events;
    const trigger = this.querySelector<HTMLAnchorElement>('.archive-search-toggle')!;
    const dialog = this.querySelector('dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('[type=search]')!;
    let categoryId = '';
    const filters = [...dialog.querySelectorAll<HTMLButtonElement>('[data-filter]')];
    const rows = dialog.querySelector<HTMLElement>('[data-rows]')!;
    const template = dialog.querySelector('template')!;
    const message = dialog.querySelector<HTMLElement>('[data-message]')!;
    const count = dialog.querySelector<HTMLElement>('[data-count]')!;
    let records: SearchRecord[] | undefined;
    let loading = false;

    const render = () => {
      if (!records) return;
      const query = normalizeSearchText(input.value);
      const fragment = document.createDocumentFragment();
      let hits = 0;
      records.forEach((record, index) => {
        if (record.kind === 'track' && !query) return;
        if ((categoryId && record.categoryId !== categoryId) || !record.text.includes(query)) return;
        const row = template.content.firstElementChild!.cloneNode(true) as HTMLAnchorElement;
        row.href = record.href;
        row.querySelector('[data-number]')!.textContent = `${{ blog: 'B', library: 'L', track: 'T' }[record.kind]}-${String(index + 1).padStart(3, '0')}`;
        row.querySelector('[data-title]')!.textContent = record.title;
        row.querySelector('[data-summary]')!.textContent = record.summary;
        row.querySelector('[data-category]')!.textContent = record.category;
        fragment.append(row);
        hits++;
      });
      rows.replaceChildren(fragment);
      rows.parentElement!.scrollTop = 0;
      message.hidden = hits > 0;
      message.textContent = records.length ? 'No matching entries. Try another term or category.' : 'No entries yet.';
      count.textContent = `${String(hits).padStart(2, '0')} RECORDS FOUND`;
    };
    const open = async () => {
      dialog.showModal();
      input.focus();
      if (records || loading) return;
      loading = true;
      message.textContent = 'Loading index…';
      try {
        const response = await fetch('/archive-search.json', { signal });
        if (!response.ok) throw new Error('Index unavailable');
        records = await response.json();
        render();
      } catch {
        if (!signal.aborted) message.textContent = 'Search unavailable. Close and reopen to retry.';
      } finally { loading = false; }
    };
    trigger.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void open();
    }, { signal });
    dialog.querySelector('[data-close]')!.addEventListener('click', () => dialog.close(), { signal });
    dialog.addEventListener('click', event => {
      const bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    }, { signal });
    input.addEventListener('input', render, { signal });
    dialog.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault();
      rows.querySelector('a')?.click();
    }, { signal });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && rows.firstElementChild) {
        event.preventDefault();
        (rows.firstElementChild as HTMLElement).focus();
      }
    }, { signal });
    filters.forEach(button => button.addEventListener('click', () => {
      categoryId = button.dataset.filter!;
      filters.forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));
      render();
    }, { signal }));
  }

  disconnectedCallback() { this.events?.abort(); }
}

if (!customElements.get('archive-search-panel')) customElements.define('archive-search-panel', ArchiveSearchPanel);
