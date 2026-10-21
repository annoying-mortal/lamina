import { t, translateError } from './i18n.js';
import { element, imagePreview, safeImageUrl, markdownImage } from './ui.js';
const $ = selector => document.querySelector(selector);
const allowed = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const sizeLabel = size => size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

export function createMediaTools({ api, getSession, message, alertError, onUnauthorized }) {
  let records = [];
  let callback = null;
  let selected = '';
  let source = 'library';
  let uploadBusy = false;
  const picker = $('#media-picker');

  async function copy(value, success) {
    try { await navigator.clipboard.writeText(value); message(success); }
    catch { message(t('Copy failed. Select the URL manually.', '复制失败，请手动选择地址。')); }
  }
  function choose(url, name = '') {
    selected = safeImageUrl(url);
    const preview = $('#picker-preview');
    preview.hidden = !selected; if (selected) preview.src = selected; else preview.removeAttribute('src');
    $('#picker-selected-label').textContent = selected ? (name ? `${name} · ${selected}` : selected) : t('Select an image', '请选择图片');
    $('#picker-use').disabled = !selected;
    $('#picker-error').hidden = true;
    for (const button of picker.querySelectorAll('[data-media-url]')) button.classList.toggle('selected', button.dataset.mediaUrl === selected);
  }
  function setSource(value) {
    source = value;
    $('#picker-library').hidden = value !== 'library'; $('#picker-url').hidden = value !== 'url';
    for (const button of picker.querySelectorAll('[data-media-tab]')) { const active = button.dataset.mediaTab === value; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
    if (value === 'url') choose($('#picker-url-input').value);
  }
  function render() {
    $('#media-count').textContent = records.length;
    const query = $('#media-search').value.trim().toLocaleLowerCase();
    const visible = records.filter(record => `${record.name} ${record.url}`.toLocaleLowerCase().includes(query));
    const list = $('#media-library-grid'); list.replaceChildren();
    for (const record of visible) {
      const card = element('article', 'media-card');
      const image = element('div', 'media-thumbnail'); image.append(imagePreview(record.url, record.name));
      const title = element('h3', '', record.name); const path = element('code', 'media-path', record.url);
      const meta = element('p', 'media-meta', `${sizeLabel(record.size)} · ${record.mime.replace('image/', '').toUpperCase()}`);
      const actions = element('div', 'media-card-actions');
      const urlButton = element('button', 'button subtle', t('Copy URL', '复制地址')); urlButton.type = 'button'; urlButton.addEventListener('click', () => copy(record.url, t('URL copied.', '地址已复制。')));
      const markdownButton = element('button', 'button subtle', t('Copy Markdown', '复制 Markdown')); markdownButton.type = 'button'; markdownButton.addEventListener('click', () => copy(markdownImage(record.url, record.name.replace(/\.[^.]+$/, '')), t('Markdown copied.', 'Markdown 已复制。')));
      actions.append(urlButton, markdownButton); card.append(image, title, meta, path, actions); list.append(card);
    }
    if (!visible.length) list.append(element('p', 'no-results', query ? t('No matches', '没有匹配项') : t('No images', '暂无图片')));
    const choices = $('#picker-media-grid'); choices.replaceChildren();
    for (const record of records) {
      const button = element('button', `media-choice${record.url === selected ? ' selected' : ''}`); button.type = 'button'; button.dataset.mediaUrl = record.url;
      button.append(imagePreview(record.url, ''), element('span', '', record.name)); button.addEventListener('click', () => choose(record.url, record.name)); choices.append(button);
    }
    if (!records.length) choices.append(element('p', 'no-results', t('No images', '暂无图片')));
  }
  async function refresh() { records = await api('/api/media'); render(); return records; }
  function open({ onSelect, alt = '', initial = '', withAlt = false, title = t('Select image', '选择图片') }) {
    callback = onSelect; $('#media-picker-title').textContent = title; $('#picker-alt-field').hidden = !withAlt;
    $('#picker-alt').value = alt; $('#picker-url-input').value = initial; $('#picker-preview').referrerPolicy = 'no-referrer';
    setSource(initial ? 'url' : 'library'); choose(initial); picker.showModal();
    refresh().catch(error => { $('#picker-error').textContent = translateError(error.message); $('#picker-error').hidden = false; });
  }
  function requestUpload() { if (!uploadBusy) $('#media-upload-input').click(); }
  async function upload(files) {
    if (uploadBusy || !files.length) return;
    uploadBusy = true; $('#picker-upload').disabled = true;
    const create = $('#create-button'); const originalLabel = create.textContent;
    if (create.dataset.upload === 'true') { create.disabled = true; create.textContent = t('Uploading…', '上传中…'); }
    let completed = 0;
    try {
      for (const file of files) {
        if (!allowed.has(file.type)) throw new Error(t(`${file.name}: use JPEG, PNG, GIF or WEBP. For SVG, use a file URL.`, `「${file.name}」请使用 JPEG、PNG、GIF 或 WEBP；SVG 请填写文件地址。`));
        if (file.size > 10 * 1024 * 1024) throw new Error(t(`${file.name} exceeds 10 MiB.`, `「${file.name}」超过 10 MiB。`));
        const response = await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name), 'X-CSRF-Token': getSession().csrf }, body: file });
        const result = await response.json();
        if (response.status === 401) { onUnauthorized?.(); const error = new Error(t('Session expired. Sign in to upload.', '会话已结束，请登录后上传。')); error.handled = true; throw error; }
        if (!response.ok) throw new Error(result.error || t(`Upload failed (${response.status}).`, `上传失败（${response.status}）。`));
        completed++; records.unshift(result);
        if (picker.open) { setSource('library'); choose(result.url, result.name); }
      }
      message(t(`${completed} image${completed === 1 ? '' : 's'} uploaded.`, `已上传 ${completed} 张图片。`));
    } catch (error) {
      if (error.handled) return;
      const errorText = translateError(error.message);
      const description = completed ? t(`${completed} uploaded. ${errorText}`, `已上传 ${completed} 张。${errorText}`) : errorText;
      if (picker.open) { $('#picker-error').textContent = description; $('#picker-error').hidden = false; } else alertError(new Error(description));
    } finally {
      uploadBusy = false; $('#picker-upload').disabled = false; $('#media-upload-input').value = '';
      if (create.dataset.upload === 'true') { create.disabled = false; create.textContent = originalLabel; }
      await refresh().catch(alertError);
    }
  }
  $('#media-upload-input').addEventListener('change', event => upload([...event.target.files]));
  $('#media-search').addEventListener('input', render);
  $('#picker-upload').addEventListener('click', requestUpload);
  $('#close-media-picker').addEventListener('click', () => picker.close());
  picker.addEventListener('close', () => { callback = null; });
  $('#picker-preview').addEventListener('error', () => { $('#picker-preview').hidden = true; $('#picker-error').textContent = t('Preview unavailable. The URL can still be saved.', '无法预览，仍可保存地址。'); $('#picker-error').hidden = false; });
  picker.querySelectorAll('[data-media-tab]').forEach(button => button.addEventListener('click', () => setSource(button.dataset.mediaTab)));
  $('#picker-url-input').addEventListener('input', () => { if (source === 'url') choose($('#picker-url-input').value); });
  $('#picker-use').addEventListener('click', () => { if (!selected || !callback) return; const apply = callback; const alt = $('#picker-alt').value.trim(); picker.close(); apply({ url: selected, alt }); });
  window.addEventListener('admin:language-change', () => {
    render();
    if (!selected) $('#picker-selected-label').textContent = t('Select an image', '请选择图片');
  });
  return { refresh, open, requestUpload };
}
