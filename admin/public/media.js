import { t, translateError } from './i18n.js';
import { element, imagePreview, safeImageUrl, markdownImage, markdownLink } from './ui.js';
const $ = selector => document.querySelector(selector);
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif', 'image/x-icon']);
const sizeLabel = size => size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

const fileGroups = [
  ['document', 'Documents', '文档'], ['audio', 'Audio', '音频'],
  ['image', 'Images', '图片'], ['other', 'Other', '其它'],
];

function fileGroup(file) {
  if (file.mime.startsWith('image/')) return 'image';
  if (file.mime.startsWith('audio/')) return 'audio';
  const ext = file.id.split('.').pop().toLowerCase();
  if (/^(bmp|tiff?|heic|heif|jxl)$/.test(ext)) return 'image';
  if (/^(aac|aif|aiff|opus|m4b|wma|mid|midi|oga|alac)$/.test(ext)) return 'audio';
  if (file.mime.startsWith('text/') || /^(pdf|json|docx?|xlsx?|pptx?|od[tsp]|rtf|epub|md|markdown|pages|key|numbers|tsv)$/.test(ext)) return 'document';
  return 'other';
}

export function createMediaTools({ api, getSession, getLibrary, message, alertError, onUnauthorized, onMutated }) {
  let records = [];
  let callback = null;
  let selected = '';
  let source = 'library';
  let uploadBusy = false;
  let deleteBusy = false;
  const picker = $('#media-picker');
  const deleteDialog = element('dialog', 'media-delete-dialog');
  deleteDialog.id = 'media-delete-dialog';
  deleteDialog.setAttribute('aria-labelledby', 'media-delete-title');
  deleteDialog.addEventListener('cancel', event => { if (deleteBusy) event.preventDefault(); });
  document.body.append(deleteDialog);

  function audioTitles(currentAlbum) {
    const titles = new Map();
    const library = getLibrary();
    const albums = currentAlbum ? [currentAlbum, ...library.filter(album => album.id !== currentAlbum.id)] : library;
    for (const album of albums) {
      for (const track of album.tracks ?? []) {
        const id = track.src.split('/').pop();
        if (!titles.has(id)) titles.set(id, new Set());
        titles.get(id).add(track.title);
      }
    }
    return titles;
  }

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
    for (const button of picker.querySelectorAll('[data-media-tab]')) button.setAttribute('aria-pressed', String(button.dataset.mediaTab === value));
    if (value === 'url') choose($('#picker-url-input').value);
  }
  function render() {
    $('#media-count').textContent = records.length;
    const query = $('#media-search').value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    const titles = audioTitles();
    const groups = new Map(fileGroups.map(([key]) => [key, []]));
    for (const record of records) {
      const names = [record.name, record.url, ...(titles.get(record.id) ?? [])];
      if (names.some(name => name.replace(/\s+/g, ' ').toLocaleLowerCase().includes(query))) groups.get(fileGroup(record)).push(record);
    }
    const list = $('#media-library-grid');
    list.replaceChildren();
    for (const [key, en, zh] of fileGroups) {
      const files = groups.get(key);
      if (query && !files.length) continue;
      const section = element('section', 'media-group');
      section.dataset.fileGroup = key;
      const heading = element('h2', 'file-group-heading', t(en, zh));
      heading.append(element('small', '', String(files.length)));
      const grid = element('div', 'media-grid');
      for (const record of files) grid.append(fileCard(record, titles.get(record.id)));
      if (!files.length) grid.append(element('p', 'muted', t('No files', '暂无文件')));
      section.append(heading, grid);
      list.append(section);
    }
    if (!list.children.length) list.append(element('p', 'no-results', t('No matches', '没有匹配项')));
  }
  function fileCard(record, titles) {
    const card = element('article', 'media-card');
    const isImage = imageTypes.has(record.mime);
    const image = element('div', 'media-thumbnail');
    image.append(isImage ? imagePreview(record.url, record.name) : element('span', 'file-type', record.name.split('.').pop().slice(0, 8).toUpperCase()));
    const title = element('h3', '', record.name); const path = element('code', 'media-path', record.url);
    const meta = element('p', 'media-meta', `${sizeLabel(record.size)} · ${record.mime.replace('image/', '').toUpperCase()}`);
    const actions = element('div', 'media-card-actions');
    const urlButton = element('button', 'button subtle', t('Copy URL', '复制地址')); urlButton.type = 'button'; urlButton.addEventListener('click', () => copy(record.url, t('URL copied.', '地址已复制。')));
    const markdownButton = element('button', 'button subtle', t('Copy Markdown', '复制 Markdown')); markdownButton.type = 'button'; markdownButton.addEventListener('click', () => copy(isImage ? markdownImage(record.url, record.name.replace(/\.[^.]+$/, '')) : markdownLink(record.url, record.name), t('Markdown copied.', 'Markdown 已复制。')));
    const download = element('a', 'button subtle', t('Download', '下载')); download.href = record.url; download.download = record.name;
    const remove = element('button', 'button danger', t('Delete', '删除')); remove.type = 'button'; remove.addEventListener('click', () => confirmRemove(record));
    actions.append(urlButton, markdownButton, download, remove); card.append(image, title);
    if (titles?.size) card.append(element('p', 'file-track-names', [...titles].join(' · ')));
    card.append(meta, path, actions);
    return card;
  }
  function confirmRemove(record) {
    if (deleteBusy) return;
    const content = element('div', 'dialog-content');
    content.append(element('span', 'eyebrow', t('DELETE', '删除')));
    const heading = element('h2', '', t('Delete file?', '删除这个文件？'));
    heading.id = 'media-delete-title';
    content.append(
      heading,
      element('p', '', t(`Delete “${record.name}”?`, `删除「${record.name}」？`)),
      element('p', 'muted', t('This deletes the uploaded file and cannot be undone.', '已上传的文件会被删除，此操作不能在后台撤销。')),
    );
    const actions = element('div', 'dialog-actions');
    const cancel = element('button', 'button subtle', t('Cancel', '取消')); cancel.type = 'button';
    const confirmButton = element('button', 'button danger', t('Delete', '确认删除')); confirmButton.type = 'button';
    cancel.addEventListener('click', () => { if (!deleteBusy) deleteDialog.close(); });
    confirmButton.addEventListener('click', async () => {
      if (deleteBusy) return;
      deleteBusy = true;
      cancel.disabled = true;
      confirmButton.disabled = true;
      try {
        await api(`/api/media/${encodeURIComponent(record.id)}`, 'DELETE', {});
        deleteDialog.close();
        if (selected === record.url) choose('');
        await refresh();
        message(t('File deleted.', '文件已删除。'));
        onMutated?.();
      } catch (error) {
        deleteDialog.close();
        alertError(error);
      } finally {
        deleteBusy = false;
        cancel.disabled = false;
        confirmButton.disabled = false;
      }
    });
    actions.append(cancel, confirmButton);
    content.append(actions);
    deleteDialog.replaceChildren(content);
    deleteDialog.showModal();
    cancel.focus();
  }
  function renderImages() {
    const choices = $('#picker-media-grid'); choices.replaceChildren();
    const images = records.filter(record => imageTypes.has(record.mime));
    for (const record of images) {
      const button = element('button', `media-choice${record.url === selected ? ' selected' : ''}`); button.type = 'button'; button.dataset.mediaUrl = record.url;
      button.append(imagePreview(record.url, ''), element('span', '', record.name)); button.addEventListener('click', () => choose(record.url, record.name)); choices.append(button);
    }
    if (!images.length) choices.append(element('p', 'no-results', t('No images', '暂无图片')));
  }
  async function refresh() { records = await api('/api/media'); render(); renderImages(); }
  function open({ onSelect, alt = '', initial = '', withAlt = false, title = t('Select image', '选择图片') }) {
    callback = onSelect; $('#media-picker-title').textContent = title; $('#picker-alt-field').hidden = !withAlt;
    $('#picker-alt').value = alt; $('#picker-url-input').value = initial; $('#picker-preview').referrerPolicy = 'no-referrer';
    setSource(initial ? 'url' : 'library'); choose(initial); picker.showModal();
    refresh().catch(error => { $('#picker-error').textContent = translateError(error.message); $('#picker-error').hidden = false; });
  }
  function requestUpload() {
    if (uploadBusy) return;
    const input = $('#media-upload-input');
    input.accept = picker.open ? [...imageTypes].join(',') : '';
    input.click();
  }
  async function uploadFile(file) {
    if (file.size > 256 * 1024 * 1024) throw new Error(t(`${file.name} exceeds 256 MiB.`, `「${file.name}」超过 256 MiB。`));
    const response = await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-CSRF-Token': getSession().csrf }, body: file });
    const result = await response.json();
    if (response.status === 401) { onUnauthorized?.(); const error = new Error(t('Session expired. Sign in to upload.', '会话已结束，请登录后上传。')); error.handled = true; throw error; }
    if (!response.ok) throw new Error(result.error || t(`Upload failed (${response.status}).`, `上传失败（${response.status}）。`));
    return result;
  }
  async function upload(files) {
    if (uploadBusy || !files.length) return;
    uploadBusy = true; $('#picker-upload').disabled = true;
    const create = $('#create-button'); const originalLabel = create.textContent;
    if (create.dataset.upload === 'true') { create.disabled = true; create.textContent = t('Uploading…', '上传中…'); }
    let completed = 0, reused = 0;
    try {
      for (const file of files) {
        if (picker.open && !imageTypes.has(file.type)) throw new Error(t('Choose an image for this field.', '此处请选择图片文件。'));
        const result = await uploadFile(file);
        if (result.reused) reused++;
        else { completed++; records.unshift(result); }
        if (picker.open) { setSource('library'); choose(result.url, result.name); }
      }
      message([
        completed && t(`${completed} file${completed === 1 ? '' : 's'} uploaded.`, `已上传 ${completed} 个文件。`),
        reused && t(`${reused} existing audio ${reused === 1 ? 'file reused' : 'files reused'}.`, `${reused} 个音频已在文件库中。`),
      ].filter(Boolean).join(' '));
    } catch (error) {
      if (error.handled) return;
      const errorText = translateError(error.message);
      const description = completed ? t(`${completed} uploaded. ${errorText}`, `已上传 ${completed} 个。${errorText}`) : errorText;
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
    render(); renderImages();
    if (!selected) $('#picker-selected-label').textContent = t('Select an image', '请选择图片');
  });
  return { refresh, open, requestUpload, uploadFile, audioTitles };
}
