import { element } from './ui.js';
import { t } from './i18n.js';

const audioExtension = /\.(mp3|m4a|ogg|wav|flac)$/i;
const fileTitle = name => name.replace(audioExtension, '') || name;
function button(label, action, className = 'button subtle') {
  const control = element('button', className, label);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

export function albumEditor({ album, category, api, media, report, message }) {
  const panel = element('fieldset', 'album-editor wide');
  const list = element('ol', 'album-edit-list');
  const dirty = () => panel.dispatchEvent(new Event('input', { bubbles: true }));
  const added = new Set();
  function add(track) {
    const file = track.src.split('/').pop();
    if (added.has(file)) return;
    added.add(file);
    const row = element('li');
    row.dataset.trackId = track.id; row.dataset.src = track.src;
    const title = element('input');
    title.value = track.title; title.required = true; title.maxLength = 200;
    title.setAttribute('aria-label', t('Track title', '曲名'));
    const actions = element('div', 'track-row-actions');
    const move = direction => {
      const sibling = direction === 'up' ? row.previousElementSibling : row.nextElementSibling;
      if (!sibling) return;
      // Move the sibling across this row so the focused control stays in place.
      if (direction === 'up') row.after(sibling); else row.before(sibling);
      updateOrder(); dirty();
    };
    const up = button(t('Move up', '上移'), () => move('up'));
    up.dataset.move = 'up';
    const down = button(t('Move down', '下移'), () => move('down'));
    down.dataset.move = 'down';
    const remove = button(t('Remove', '移除'), () => { row.remove(); added.delete(file); updateOrder(); showMatches(); dirty(); }, 'button track-remove');
    actions.append(up, down, remove);
    const line = element('div', 'track-row');
    line.append(title, actions); row.append(line); list.append(row);
  }
  function updateOrder() {
    for (const row of list.children) {
      row.querySelector('[data-move="up"]').disabled = !row.previousElementSibling;
      row.querySelector('[data-move="down"]').disabled = !row.nextElementSibling;
    }
  }
  function addFile(file, title) {
    if (added.has(file.id)) {
      message(t('Already in this album.', '这首音频已在专辑中。'));
      return;
    }
    add({ id: crypto.randomUUID(), title, src: file.url });
    updateOrder(); showMatches(); dirty();
  }
  for (const track of album.tracks ?? []) add(track);
  updateOrder();

  const search = element('input');
  search.type = 'search';
  search.placeholder = t('Search track or file name', '搜索曲名或音频文件名');
  search.setAttribute('aria-label', search.placeholder);
  const results = element('div', 'track-results');
  let choices = [];
  function showMatches() {
    const query = search.value.trim().replace(/\s+/g, ' ').toLowerCase();
    results.replaceChildren();
    for (const { file, title, text } of choices) {
      if (!text.includes(query)) continue;
      const entry = button('', () => addFile(file, title), 'track-choice');
      const name = element('span', 'track-choice-title', title);
      if (title !== file.name) name.append(element('small', '', file.name));
      entry.disabled = added.has(file.id);
      entry.append(name, element('span', 'track-add', entry.disabled ? t('Added', '已添加') : t('+ Add', '＋ 添加')));
      results.append(entry);
    }
    if (!results.children.length) results.append(element('p', 'muted', query ? t('No matching audio', '没有匹配的音频') : t('No uploaded audio', '暂无已上传音频')));
  }
  async function refresh() {
    const records = await api('/api/media');
    const titles = media.audioTitles(album);
    choices = records.filter(file => audioExtension.test(file.url)).flatMap(file =>
      Array.from(titles.get(file.id) ?? [fileTitle(file.name)], title => ({
        file, title, text: [title, file.name].join(' ').replace(/\s+/g, ' ').toLowerCase(),
      })));
    showMatches();
  }
  search.addEventListener('input', event => { event.stopPropagation(); showMatches(); });
  search.addEventListener('change', event => event.stopPropagation());
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault(); results.querySelector('button')?.focus();
    }
  });
  function sync() {
    panel.hidden = panel.disabled = category.value !== 'albums';
    if (!panel.hidden) refresh().catch(report);
  }
  category.addEventListener('change', () => {
    if (category.value !== 'albums' && list.children.length) {
      category.value = 'albums'; report(new Error(t('Remove album tracks before changing category.', '请先移除曲目，再切换专辑分类。'))); return;
    }
    sync();
  });
  const upload = element('input');
  upload.type = 'file'; upload.multiple = true; upload.accept = '.mp3,.m4a,.ogg,.wav,.flac'; upload.hidden = true;
  const uploadButton = button(t('Upload audio', '上传音频'), () => upload.click());
  upload.addEventListener('change', async () => {
    const batch = [...upload.files];
    if (!batch.length) return;
    panel.dataset.uploading = 'true'; uploadButton.disabled = true; category.disabled = true;
    try {
      for (const file of batch) {
        if (!audioExtension.test(file.name)) throw new Error(t('Unsupported audio format.', '不支持此音频格式。'));
        const record = await media.uploadFile(file);
        if (!panel.isConnected) return;
        addFile(record, fileTitle(record.name));
      }
      await refresh();
    } catch (error) { report(error); }
    finally { delete panel.dataset.uploading; upload.value = ''; uploadButton.disabled = false; category.disabled = false; }
  });
  const sources = element('div', 'track-sources');
  sources.append(search, uploadButton, upload, results);
  panel.append(element('legend', '', t('Album tracks · play in list order', '专辑曲目 · 按列表顺序播放')), list, sources);
  sync(); return panel;
}
