import { t, getLocale, translateError } from './i18n.js';
import { mountSettingsPreview } from './settings-preview.js';
import { element, imagePreview, safeImageUrl, siteImageUrl, renderMarkdown, markdownImage } from './ui.js';
import { createMediaTools } from './media.js';
import { initAccount } from './account.js';
import { createBackupTools } from './backup.js';
const $ = selector => document.querySelector(selector);
const sectionNames = { blog: ['Blog', '文章'], library: ['Library', '收藏'], friends: ['Friends', '友链'], media: ['Media', '素材库'], settings: ['Settings', '站点设置'], backup: ['Backup', '备份'] };
const sectionLabel = kind => t(...sectionNames[kind]);
const state = { kind: 'blog', records: { blog: [], library: [], friends: [] }, settings: null, session: null, current: null, dirty: false, busy: false, backupBusy: false, publishBusy: false, refreshing: false, authRedirecting: false };
const form = $('#editor');
let toastTimer;
let navigationVersion = 0;
let settingsPreviewCleanup;
const recoveryKey = 'field-admin-recovery-v1';
const restoredBackupKey = 'field-admin-backup-restored-v1';
let recoverable = null;
function message(text) { const toast = $('#toast'); toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 3200); }
function alertError(error) { if (error.handled || state.authRedirecting) return; $('#alert').textContent = translateError(error.message || String(error)); $('#alert').hidden = false; }
function clearError() { $('#alert').hidden = true; }
async function api(path, method = 'GET', data, options = {}) {
  const headers = { ...options.headers };
  if (method !== 'GET') { headers['Content-Type'] = options.contentType || 'application/json'; headers['X-CSRF-Token'] = state.session?.csrf || ''; }
  const response = await fetch(path, { method, headers, ...(data !== undefined ? { body: options.raw ? data : JSON.stringify(data) } : {}) });
  if (response.status === 401) { handleUnauthorized(); const error = new Error(t("Session expired. Sign in again.", "登录已失效，请重新登录。")); error.status = 401; error.handled = true; throw error; }
  if (response.ok && options.response === 'blob') {
    const filename = response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/i)?.[1];
    return { blob: await response.blob(), filename: filename?.replace(/[\\/\r\n]/g, '_'), warningCount: Number(response.headers.get('X-Backup-Warnings') || 0) };
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || t(`Request failed (${response.status})`, `请求失败（${response.status}）`)); return result;
}
const media = createMediaTools({ api, getSession: () => state.session, message, alertError, onUnauthorized: handleUnauthorized });
const backup = createBackupTools({
  api, clearError,
  onBusy: value => {
    state.backupBusy = value;
    for (const button of document.querySelectorAll('[data-kind], #account-button, #logout-button, #restore-recovery, #discard-recovery')) button.disabled = value;
    $('#publish-button').disabled = value || state.publishBusy;
  },
  onRestored: result => {
    clearRecovery(); markDirty(false);
    try { sessionStorage.setItem(restoredBackupKey, JSON.stringify({ rollbackId: result.rollbackId })); } catch {}
    window.location.reload();
  },
});

function applyIdentity(info) {
  if (info.defaultTheme) window.FieldTheme?.setDefault(info.defaultTheme);
  const name = info.name || t("Please enter site name", "请填写站点名称");
  $('#workspace-name').textContent = name;
  document.title = t("CMS · ", "内容工作台 · ") + name;
  const mark = $('#workspace-mark');
  const logo = siteImageUrl(info.logo, info.siteUrl || state.session?.siteUrl);
  mark.hidden = true;
  mark.onload = () => { mark.hidden = false; };
  mark.onerror = () => { mark.hidden = true; };
  if (logo) mark.src = logo; else mark.removeAttribute('src');
}
function preserveRecovery() {
  if (!state.dirty || !state.current || form.hidden) return true;
  try {
    const snapshot = { kind: state.kind, record: { ...state.current, ...formValue() }, savedAt: new Date().toISOString() };
    sessionStorage.setItem(recoveryKey, JSON.stringify(snapshot)); return true;
  } catch { return false; }
}
function handleUnauthorized() {
  if (state.authRedirecting) return;
  if (!preserveRecovery()) {
    const box = $('#alert'); box.hidden = false;
    box.replaceChildren(element('p', '', t("Session expired. Copy your unsaved work or sign in in another tab to continue.", "登录已失效，浏览器无法暂存未提交的修改。内容仍保留在本页，请先复制备份，或在新标签页登录后继续。")));
    const link = element('a', 'button subtle', t("Sign in ↗", "在新标签页登录 ↗")); link.href = '/login?expired=1'; link.target = '_blank'; link.rel = 'noopener';
    const retry = element('button', 'button subtle', t("Resume", "已登录，继续编辑")); retry.type = 'button';
    retry.addEventListener('click', async () => { try { state.session = await api('/api/session'); clearError(); message(t("Signed in. Your changes are preserved.", "登录已恢复，当前修改仍保留。")); } catch (error) { alertError(error); } });
    box.append(link, retry); return;
  }
  state.authRedirecting = true;
  window.location.assign('/login?expired=1');
}
function isRecoveryRecord(kind, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const strings = keys => keys.every(key => typeof record[key] === 'string');
  const tags = () => Array.isArray(record.tags) && record.tags.length <= 100 && record.tags.every(tag => typeof tag === 'string');
  if (kind === 'blog') return strings(['id', 'slug', 'title', 'summary', 'body', 'categoryId', 'date']) && record.body.length <= 300000 && tags() && typeof record.draft === 'boolean';
  if (kind === 'library') return strings(['id', 'title', 'original', 'type', 'creator', 'date', 'cover', 'note', 'detail']) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.type) && record.type !== 'all' && record.type.length <= 80 && tags();
  if (kind === 'friends') return strings(['id', 'name', 'url', 'avatar', 'description']) && typeof record.visible === 'boolean';
  if (kind !== 'settings' || !strings(['name', 'title', 'description']) || !record.pages || !Array.isArray(record.categories) || record.categories.length > 100 || !Array.isArray(record.navigation) || record.navigation.length !== 4) return false;
  if (new Set(record.navigation.map(item => item?.id)).size !== 4) return false;
  if (record.aboutHighlights !== undefined && (!Array.isArray(record.aboutHighlights) || record.aboutHighlights.length > 6 || !record.aboutHighlights.every(item => item && ['label', 'title', 'description', 'period', 'url'].every(key => typeof item[key] === 'string')))) return false;
  if (record.orbitImage !== undefined && (typeof record.orbitImage !== 'string' || record.orbitImage.length > 2000)) return false;
  if (record.libraryTypes !== undefined && (!Array.isArray(record.libraryTypes) || record.libraryTypes.length > 30 || !record.libraryTypes.every(item => item && ['id', 'label', 'en'].every(key => typeof item[key] === 'string')))) return false;
  return record.navigation.every(item => item && ['home', 'blog', 'library', 'friends'].includes(item.id) && typeof item.label === 'string' && typeof item.visible === 'boolean')
    && record.categories.every(item => item && ['id', 'label', 'en'].every(key => typeof item[key] === 'string'))
    && ['blog', 'library', 'friends'].every(id => record.pages[id] && ['title', 'eyebrow', 'description'].every(key => typeof record.pages[id][key] === 'string'));
}
function readRecovery() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
    if (!saved || !['blog', 'library', 'friends', 'settings'].includes(saved.kind) || !isRecoveryRecord(saved.kind, saved.record)) return;
    recoverable = saved;
    $('#recovery-description').textContent = sectionLabel(saved.kind) + ' · ' + (saved.record.title || saved.record.name || t("Untitled", "未命名")) + t(". Review before saving.", "。恢复后请检查内容，再保存到网站。");
    $('#recovery-banner').hidden = false;
  } catch {}
}
function clearRecovery() {
  try { sessionStorage.removeItem(recoveryKey); } catch {}
  recoverable = null; $('#recovery-banner').hidden = true;
}

function markDirty(value) { state.dirty = value; $('#dirty-state').textContent = value ? t("Unsaved changes", "有未保存修改") : t("Saved", "已保存"); $('#dirty-state').classList.toggle('changed', value); }
function mayLeave() { return !state.dirty || confirm(t("Discard unsaved changes?", "当前修改尚未保存，确定放弃这些修改？")); }
function setBusy(value) {
  state.busy = value; $('#fields').inert = value;
  $('#save-button').disabled = value; $('#save-top-button').disabled = value; $('#create-button').disabled = value; $('#delete-button').disabled = value;
  $('#refresh-records').disabled = value || state.refreshing;
  $('#save-top-button').textContent = value ? t('Saving…', '正在保存…') : t('Save', '保存');
  $('#save-button').textContent = value ? t("Saving…", "正在保存…") : state.current?.revision ? t("Save", "保存修改") : t("Save", "保存内容");
}
function renderList() {
  for (const kind of ['blog', 'library', 'friends']) $(`#${kind}-count`).textContent = state.records[kind].length;
  if (!(state.kind in state.records)) return;
  const query = $('#search').value.trim().toLocaleLowerCase();
  const records = state.records[state.kind].filter(item => [item.title, item.name, item.summary, item.description, item.creator, item.url, item.sourcePath, ...(item.tags || [])].join(' ').toLocaleLowerCase().includes(query));
  const list = $('#record-list'); list.replaceChildren(); $('#result-count').textContent = records.length;
  if (!records.length) { list.append(element('p', 'no-results', query ? t("No results.", "没有找到匹配内容。") : t("No content yet.", "这里还没有内容，开始一条新记录吧。"))); return; }
  for (const record of records) {
    const button = element('button', `record${state.current?.id === record.id ? ' selected' : ''}`); button.type = 'button'; button.setAttribute('aria-pressed', String(state.current?.id === record.id));
    button.append(element('span', 'record-title', record.title || record.name));
    const metadata = element('span', 'record-meta');
    if (record.date) { const date = element('time', '', record.date); date.dateTime = record.date; metadata.append(date); }
    const label = state.kind === 'blog' ? state.session.categories.find(item => item.id === record.categoryId)?.label : state.kind === 'friends' ? record.kind : state.session.libraryTypes.find(item => item.id === record.type)?.label || record.typeLabel;
    metadata.append(element('span', '', label || t("Uncategorized", "未分类")));
    if (record.draft) metadata.append(element('span', 'status-pill', t("Draft", "草稿")));
    if (record.visible === false) metadata.append(element('span', 'status-pill', t("Hidden", "已隐藏")));
    if (record.demo) metadata.append(element('span', 'demo-pill', t("Demo", "示例")));
    button.append(metadata); button.addEventListener('click', () => { if (!state.busy && mayLeave()) { clearError(); edit(record); } }); list.append(button);
  }
}
function field(name, label, value, options = {}) {
  const wrapper = element('label', `field${options.wide ? ' wide' : ''}`); wrapper.append(element('span', 'field-label', label));
  let input;
  if (options.choices) { input = element('select'); for (const choice of options.choices) { const option = element('option', '', choice.label); option.value = choice.id; input.append(option); } }
  else if (options.multiline) { input = element('textarea'); input.rows = options.rows || 3; }
  else { input = element('input'); input.type = options.type || 'text'; }
  input.name = name; input.value = value ?? '';
  if (options.required) input.required = true;
  if (options.readonly) input.readOnly = true;
  if (!options.choices && !options.readonly) input.placeholder = options.placeholder || t(`Please enter ${label.split(' / ')[0].toLowerCase()}`, `请填写${label.split(' / ')[0]}`);
  if (options.max) input.maxLength = options.max;
  if (options.min !== undefined) input.min = options.min;
  if (options.numericMax !== undefined) input.max = options.numericMax;
  if (options.pattern) input.pattern = options.pattern;
  wrapper.append(input); if (options.hint) wrapper.append(element('small', '', options.hint)); return wrapper;
}
function checkboxField(name, label, value) {
  const wrapper = element('label', 'check-field'); const input = element('input'); input.type = 'checkbox'; input.name = name; input.checked = Boolean(value); wrapper.append(input, element('span', '', label)); return wrapper;
}
function imageField(name, label, value, hint = t("Local path or HTTP(S) URL.", "可填写站内路径或 HTTP(S) 外链，也可从素材库选择。")) {
  const wrapper = element('div', 'field wide image-field'); const control = field(name, label, value, { max: 2000, placeholder: t(`Please enter ${label.toLowerCase()} URL`, `请填写${label}${label.endsWith('地址') ? '' : '地址'}`) });
  const row = element('div', 'image-field-bottom'); const preview = element('div', 'image-field-preview'); const status = element('span', 'muted');
  const input = control.querySelector('input');
  const update = () => { preview.replaceChildren(); const url = ['logo', 'orbitImage'].includes(name) ? siteImageUrl(input.value, state.session?.siteUrl) : safeImageUrl(input.value); preview.hidden = !url; status.textContent = input.value && !url ? t("Enter a local path or HTTP(S) image URL.", "请输入站内路径或 HTTP(S) 图片地址。") : ''; if (url) { const image = imagePreview(url, t("Image preview", "图片预览")); image.addEventListener('error', () => { status.textContent = t("Image unavailable. Check the URL.", "图片暂时无法加载，请检查地址。"); }); preview.append(image); } };
  const choose = element('button', 'button subtle', t("Choose image", "选择 / 上传图片")); choose.type = 'button'; choose.addEventListener('click', () => media.open({ initial: input.value, title: t(`Choose ${label.toLowerCase()}`, `选择${label}`), onSelect: ({ url }) => { input.value = url; input.dispatchEvent(new Event('input', { bubbles: true })); } }));
  input.addEventListener('input', update); row.append(choose, status); wrapper.append(control, row, preview, element('small', '', hint)); update(); return wrapper;
}
function bodyField(value) {
  const wrapper = element('div', 'field wide'); const header = element('div', 'body-heading');
  const label = element('label', 'field-label', t("Content · Markdown", "正文 / Markdown")); label.htmlFor = 'markdown-body';
  const tabs = element('div', 'editor-tabs'); const insertButton = element('button', '', t("Image", "插入图片")); insertButton.type = 'button';
  const editButton = element('button', 'active', t("Edit", "编辑")); editButton.type = 'button'; editButton.dataset.editorMode = 'edit'; editButton.setAttribute('aria-pressed', 'true');
  const previewButton = element('button', '', t("Preview", "排版预览")); previewButton.type = 'button'; previewButton.setAttribute('aria-pressed', 'false');
  tabs.append(insertButton, editButton, previewButton); header.append(label, tabs);
  const textarea = element('textarea'); textarea.name = 'body'; textarea.id = 'markdown-body'; textarea.value = value; textarea.required = true; textarea.maxLength = 300000; textarea.spellcheck = false;
  textarea.placeholder = t("Please enter content", "请填写内容"); const preview = element('div', 'markdown-preview'); preview.hidden = true;
  const showEdit = () => { textarea.hidden = false; preview.hidden = true; editButton.classList.add('active'); previewButton.classList.remove('active'); editButton.setAttribute('aria-pressed', 'true'); previewButton.setAttribute('aria-pressed', 'false'); };
  editButton.addEventListener('click', showEdit);
  previewButton.addEventListener('click', () => { renderMarkdown(textarea.value, preview); textarea.hidden = true; preview.hidden = false; previewButton.classList.add('active'); editButton.classList.remove('active'); editButton.setAttribute('aria-pressed', 'false'); previewButton.setAttribute('aria-pressed', 'true'); });
  insertButton.addEventListener('click', () => {
    const start = textarea.selectionStart; const end = textarea.selectionEnd;
    media.open({ title: t("Insert image", "插入正文图片"), withAlt: true, onSelect: ({ url, alt }) => { showEdit(); const snippet = markdownImage(url, alt); textarea.setRangeText(`${start && textarea.value[start - 1] !== '\n' ? '\n' : ''}${snippet}\n`, start, end, 'end'); markDirty(true); textarea.focus(); } });
  });
  textarea.addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end'); markDirty(true); } });
  wrapper.append(header, textarea, preview); return wrapper;
}
function updatePreviewLink() {
  const link = $('#preview-link');
  if (!state.session) return;
  if (state.kind === 'blog') {
    const slug = form.elements.namedItem('slug')?.value;
    link.href = new URL(`/blog/${encodeURIComponent(slug || '')}/`, state.session.siteUrl).href;
    link.hidden = !state.current?.revision || state.current.draft || form.elements.namedItem('draft')?.checked || slug !== state.current.slug;
  } else { link.href = new URL(state.kind === 'settings' ? '/' : `/${state.kind}/`, state.session.siteUrl).href; link.hidden = !state.current?.revision; }
}
function edit(record) {
  if (state.kind === 'settings') { editSettings(record); return; }
  settingsPreviewCleanup?.(); settingsPreviewCleanup = null;
  state.current = structuredClone(record); markDirty(false); $('#empty-editor').hidden = true; form.hidden = false; $('#editor-eyebrow').hidden = false;
  const existing = Boolean(record.revision); $('#editor-eyebrow').textContent = existing ? t("EDIT", "EDIT / 编辑") : t("NEW", "NEW / 新建");
  $('#editor-title').textContent = `${existing ? t('Edit', '编辑') : t('New', '新建')} ${sectionLabel(state.kind)}`;
  $('#delete-button').hidden = !existing; $('#save-button').textContent = existing ? t("Save", "保存修改") : t("Save", "保存内容");
  const grid = element('div', 'form-grid');
  if (state.kind === 'blog') {
    const source = element('div', 'article-source wide');
    source.append(element('span', 'field-label', t("MARKDOWN", "来源文件 / MARKDOWN")));
    if (record.sourcePath) source.append(element('code', 'source-path', `src/content/blog/${record.sourcePath}`));
    else source.append(element('span', 'source-path', t("Markdown file created on save", "保存后生成 Markdown 文件")));
    
    grid.append(source);
    grid.append(
      field('title', t("Title", "文章标题"), record.title, { required: true, wide: true, max: 200, placeholder: t("Please enter title", "请填写文章标题") }),
      checkboxField('draft', t("Draft", "草稿"), record.draft),
      field('summary', t("Summary", "摘要"), record.summary, { required: true, wide: true, multiline: true, rows: 2, max: 1000, placeholder: t("Please enter summary", "请填写摘要") }),
      field('id', t("ID", "稳定 ID"), record.id, { required: true, readonly: existing, max: 80, pattern: '[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}', hint: t("Permanent after creation.", "用于档案定位，创建后保持不变。") }),
      field('slug', t("Slug", "文章网址"), record.slug, { required: true, max: 100, pattern: '[a-z0-9]+(-[a-z0-9]+)*', placeholder: t("Please enter slug", "请填写文章网址"), hint: t("/blog/slug/ · Lowercase letters, numbers and hyphens.", "/blog/文章网址/ · 小写字母、数字和连字符") }),
      field('categoryId', t("Category", "分类"), record.categoryId, { choices: state.session.categories }),
      field('date', t("Date", "发布日期"), record.date, { type: 'date', required: true }),
      field('tags', t("Tags", "标签"), (record.tags || []).join(', '), { placeholder: t("Please enter tags", "请填写tag"), hint: t("Comma-separated, up to 20.", "用逗号分隔，最多 20 个。") }),
      field('readTime', t("Read time · minutes", "阅读时长 / 分钟"), record.readTime, { type: 'number', min: 1, numericMax: 999, required: true }), bodyField(record.body || '')
    );
  } else if (state.kind === 'library') {
    const type = ({ book: 'books', screen: 'acgn', music: 'albums' })[record.type] || record.type;
    const choices = [...state.session.libraryTypes];
    // Retain a recovered value until the user chooses a configured category.
    if (type && !choices.some(item => item.id === type)) choices.unshift({ id: type, label: `${type} · ${t('Unavailable', '已移除')}` });
    grid.append(
      field('title', t("Title", "作品名称"), record.title, { wide: true, required: true, max: 200, placeholder: t("Please enter title", "请填写作品名称") }),
      field('original', t("Original title", "原名 / 外文名"), record.original, { wide: true, max: 200 }),
      field('id', t("ID", "稳定 ID"), record.id, { required: true, readonly: existing, max: 80, pattern: '[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}' }),
      field('type', t("Category", "分类"), type, { required: true, choices }),
      field('typeLabel', t("Type label", "具体类型"), record.typeLabel, { max: 60, placeholder: t("Please enter type label", "请填写具体类型"), hint: t("Optional.", "留空时使用上面的分类名称。") }),
      field('creator', t("Creator", "创作者"), record.creator, { max: 200, placeholder: t("Please enter creator", "请填写创作者") }),
      field('date', t("Date", "记录日期"), record.date, { type: 'date', required: true }), field('rating', t("Rating · /10", "评分 / 10"), record.rating, { max: 4, placeholder: t("Please enter rating", "请填写评分"), hint: t("0–10. Optional.", "0–10 分，可留空。") }),
      imageField('cover', t("Cover", "封面地址"), record.cover, t("Local path or HTTP(S) URL. Optional.", "留空使用文字封面；站内路径或 HTTP(S) 外链均可。")),
      field('tags', t("Tags", "标签"), (record.tags || []).join(', '), { wide: true, placeholder: t("Please enter tags", "请填写tag"), hint: t("Comma-separated.", "用逗号分隔。") }),
      field('note', t("Summary", "一句短评"), record.note, { wide: true, multiline: true, rows: 2, max: 1000 }), field('detail', t("Notes", "详细记录"), record.detail, { wide: true, multiline: true, rows: 7, max: 20000 }),
      field('article', t("Related post", "关联文章"), record.article || '', { wide: true, placeholder: t("Please enter post URL", "请填写关联文章地址"), hint: t("/blog/slug/ · Optional.", "可选，格式为 /blog/文章网址/，将收藏关联到一篇已发布文章。") })
    );
  } else {
    grid.append(
      field('name', t("Site name", "站点名称"), record.name, { wide: true, required: true, max: 200 }),
      field('url', t("Website URL", "网站地址"), record.url, { required: true, type: 'url', max: 2000, placeholder: t("Please enter website URL", "请填写网站地址"), hint: t("Full HTTP(S) URL.", "填写完整的 HTTP(S) 网址。") }),
      imageField('avatar', t("Avatar", "头像地址"), record.avatar, t("Optional.", "留空使用下方的文字标识。")), field('initials', t("Initials", "文字标识"), record.initials, { max: 8, placeholder: t("Please enter initials", "请填写文字标识") }),
      field('kind', t("Type", "类型"), record.kind, { max: 80, placeholder: t("Please enter type", "请填写类型") }), field('label', t("Label", "英文标签"), record.label, { max: 100, placeholder: t("Please enter label", "请填写英文标签") }),
      field('order', t("Order", "显示顺序"), record.order ?? 0, { type: 'number', min: 0, numericMax: 99999, hint: t("Lowest first.", "数字越小越靠前。") }),
      field('description', t("Description", "站点简介"), record.description, { wide: true, multiline: true, rows: 3, max: 2000 }), checkboxField('visible', t("Visible", "在友链页面显示"), record.visible !== false)
    );
  }
  grid.append(checkboxField('demo', t("Demo", "示例内容"), record.demo));
  $('#fields').replaceChildren(grid); updatePreviewLink(); renderList();
}
function settingsSection(title, description) {
  const section = element('section', 'settings-section'); section.append(element('h3', '', title)); if (description) section.append(element('p', 'muted settings-description', description)); const grid = element('div', 'form-grid'); section.append(grid); return { section, grid };
}
function moveRow(rows, row, direction) {
  if (direction === 'up' && row.previousElementSibling) rows.insertBefore(row, row.previousElementSibling);
  else if (direction === 'down' && row.nextElementSibling) rows.insertBefore(row.nextElementSibling, row);
}
function aboutHighlightFields(records) {
  const section = element('div', 'about-highlights-editor wide');
  const heading = element('div', 'about-highlights-heading');
  heading.append(element('h4', '', t('Highlights', '个人成就')));
  const count = element('span', 'muted'); heading.append(count);
  const rows = element('div', 'about-highlight-rows');
  const add = element('button', 'button subtle', t('+ Add highlight', '＋ 新增成就')); add.type = 'button';
  const updateOrder = () => {
    const all = [...rows.children]; count.textContent = `${all.length} / 6`; add.disabled = all.length >= 6;
    all.forEach((row, index) => {
      row.querySelector('[data-highlight-number]').textContent = String(index + 1).padStart(2, '0');
      for (const direction of ['up', 'down']) {
        const button = row.querySelector(`[data-highlight-move="${direction}"]`);
        button.disabled = direction === 'up' ? index === 0 : index === all.length - 1;
        button.setAttribute('aria-label', direction === 'up' ? t(`Move highlight ${index + 1} up`, `上移第 ${index + 1} 条成就`) : t(`Move highlight ${index + 1} down`, `下移第 ${index + 1} 条成就`));
      }
      row.querySelector('[data-highlight-remove]').setAttribute('aria-label', t(`Remove highlight ${index + 1}`, `移除第 ${index + 1} 条成就`));
    });
  };
  const addRow = item => {
    const row = element('div', 'about-highlight-row'); row.dataset.aboutHighlightRow = '';
    const rowHeading = element('div', 'about-highlight-row-heading wide');
    const number = element('span', 'muted'); number.dataset.highlightNumber = ''; rowHeading.append(number);
    const actions = element('div', 'row-actions');
    for (const [direction, label] of [['up', '↑'], ['down', '↓']]) {
      const button = element('button', 'button subtle', label); button.type = 'button'; button.dataset.highlightMove = direction;
      button.addEventListener('click', () => { moveRow(rows, row, direction); updateOrder(); markDirty(true); });
      actions.append(button);
    }
    const remove = element('button', 'text-danger', t('Remove', '移除')); remove.type = 'button'; remove.dataset.highlightRemove = '';
    remove.addEventListener('click', () => { row.remove(); updateOrder(); markDirty(true); }); actions.append(remove); rowHeading.append(actions); row.append(rowHeading);
    for (const [key, label, options] of [
      ['label', t('Label', '领域'), { max: 80 }], ['period', t('Period', '时间'), { max: 80 }],
      ['title', t('Title', '成就标题'), { max: 200, required: true, wide: true }],
      ['description', t('Summary', '成就简介'), { max: 500, multiline: true, rows: 2, wide: true }],
      ['url', t('URL', '链接'), { max: 2000, type: 'url', wide: true }],
    ]) {
      const control = field(`aboutHighlights.${key}`, label, item[key], options);
      control.querySelector('input, textarea').dataset.highlightKey = key; row.append(control);
    }
    rows.append(row); updateOrder(); return row;
  };
  records.forEach(addRow);
  add.addEventListener('click', () => { if (rows.children.length >= 6) return; const row = addRow({}); markDirty(true); row.querySelector('[data-highlight-key="title"]').focus(); });
  section.append(heading, rows, add); updateOrder(); return section;
}
function libraryTypeFields(records) {
  const section = element('div', 'library-types-editor wide');
  const rows = element('div', 'library-type-rows');
  const add = element('button', 'button subtle add-category', t('+ Add category', '＋ 新增分类')); add.type = 'button';
  const updateOrder = () => {
    const all = [...rows.children]; add.disabled = all.length >= 30;
    all.forEach((row, index) => {
      row.querySelector('[data-library-type-number]').textContent = String(index + 1).padStart(2, '0');
      row.querySelector('[data-library-type-move="up"]').disabled = index === 0;
      row.querySelector('[data-library-type-move="down"]').disabled = index === all.length - 1;
    });
  };
  const addRow = item => {
    const row = element('div', 'library-type-row'); row.dataset.libraryTypeRow = '';
    const heading = element('div', 'library-type-row-heading wide');
    const number = element('span', 'muted'); number.dataset.libraryTypeNumber = ''; heading.append(number);
    const actions = element('div', 'row-actions');
    for (const [direction, label] of [['up', '↑'], ['down', '↓']]) {
      const button = element('button', 'button subtle', label); button.type = 'button'; button.dataset.libraryTypeMove = direction;
      button.setAttribute('aria-label', direction === 'up' ? t('Move category up', '上移分类') : t('Move category down', '下移分类'));
      button.addEventListener('click', () => { moveRow(rows, row, direction); updateOrder(); markDirty(true); }); actions.append(button);
    }
    const remove = element('button', 'text-danger', t('Remove', '移除')); remove.type = 'button';
    remove.setAttribute('aria-label', t(`Remove category ${item.label || ''}`, `移除分类 ${item.label || ''}`));
    remove.addEventListener('click', () => { row.remove(); updateOrder(); markDirty(true); }); actions.append(remove); heading.append(actions); row.append(heading);
    for (const [key, label, max] of [['id', 'ID', 60], ['label', t('Name', '名称'), 60], ['en', t('Archive label', '档案标签'), 100]]) {
      const control = field(`libraryType.${key}`, label, item[key], { required: key !== 'en', max, ...(key === 'id' ? { readonly: Boolean(item.id), pattern: '[a-z0-9]+(-[a-z0-9]+)*', hint: item.id === 'all' ? t('All entries', '全部内容') : undefined } : {}) });
      control.querySelector('input').dataset.libraryTypeKey = key; row.append(control);
    }
    rows.append(row); updateOrder(); return row;
  };
  records.forEach(addRow);
  add.addEventListener('click', () => { if (rows.children.length >= 30) return; const row = addRow({ id: '', label: '', en: '' }); markDirty(true); row.querySelector('input').focus(); });
  section.append(rows, add); updateOrder(); return section;
}
function editSettings(record) {
  state.current = structuredClone(record); markDirty(false); $('#empty-editor').hidden = true; form.hidden = false; $('#delete-button').hidden = true;
  $('#editor-eyebrow').hidden = true; $('#editor-title').textContent = t("Settings", "设置"); $('#save-button').textContent = t("Save", "保存设置");
  const fragment = document.createDocumentFragment();
  const identity = settingsSection(t("Identity", "基本信息"), '');
  identity.grid.append(field('name', t("Site name", "站点名称"), record.name, { required: true, max: 100 }), field('title', t("Page title", "浏览器标题 / SEO"), record.title, { required: true, max: 200 }), field('description', t("Description", "站点描述"), record.description, { wide: true, multiline: true, rows: 2, max: 1000 }), field('url', t("Site URL", "公开网址"), record.url, { wide: true, type: 'url', placeholder: t("Please enter site URL", "请填写公开网址"), hint: t("Full HTTP(S) URL. Optional.", "完整 HTTP(S) 网址，可留空。") }), imageField('logo', 'Logo', record.logo, t("/logo.svg or HTTP(S) URL. Optional.", "/logo.svg 或 HTTP(S) 地址，可留空。")), imageField('favicon', 'Favicon', record.favicon, t("/favicon.svg or HTTP(S) URL.", "/favicon.svg 或 HTTP(S) 地址。")), field('defaultTheme', t("Theme", "默认主题"), record.defaultTheme, { choices: [{ id: 'system', label: t("System", "跟随系统") }, { id: 'light', label: t("Light", "日间模式") }, { id: 'dark', label: t("Dark", "夜间模式") }], hint: '' }), field('github', t("GitHub URL", "GitHub 地址"), record.github, { type: 'url', max: 2000 }), field('email', t("Email", "联系邮箱"), record.email, { type: 'email', max: 254 }), checkboxField('showRSS', t("RSS", "RSS"), record.showRSS), checkboxField('demo', t("Demo notice", "显示站点示例说明"), record.demo)); fragment.append(identity.section);
  const home = settingsSection(t("Home & Archive", "Home 与档案"), t("Use {name} for the site name.", "使用 {name} 引用站名。"));
  home.grid.append(field('tagline', t("Heading", "首页主标题"), record.tagline, { wide: true, multiline: true, max: 500 }), field('intro', t("Introduction", "首页简介"), record.intro, { wide: true, multiline: true, rows: 3, max: 2000 }), field('eyebrow', t("Eyebrow", "首页上方小字"), record.eyebrow, { wide: true, max: 200 }), field('homeEdition', t("Bottom text", "首页底部文字"), record.homeEdition, { wide: true, max: 300 }), imageField('orbitImage', t('Orbit image', '圆环图片'), record.orbitImage, t('Home & sign-in', '首页与登录页')), field('archiveTitle', t("Archive title", "档案标题"), record.archiveTitle, { max: 100 }), field('archiveSubtitle', t("Archive subtitle", "档案副标题"), record.archiveSubtitle, { max: 200 })); fragment.append(home.section);
  const about = settingsSection(t("About", "Home · 个人介绍"), '');
  about.grid.append(field('aboutEyebrow', t("Eyebrow", "上方小字"), record.aboutEyebrow, { wide: true, max: 200 }), field('aboutTitle', t("Heading", "介绍标题"), record.aboutTitle, { wide: true, multiline: true, rows: 2, max: 300 }), field('aboutBody', t("Content", "介绍正文"), record.aboutBody, { wide: true, multiline: true, rows: 3, max: 6000 }), aboutHighlightFields(record.aboutHighlights || state.settings?.aboutHighlights || [])); fragment.append(about.section);
  const contact = settingsSection(t("Contact", "Home · 联系与运行时间"), '');
  contact.grid.append(field('contactEyebrow', t("Eyebrow", "上方小字"), record.contactEyebrow, { wide: true, max: 200 }), field('contactTitle', t("Heading", "联系页标题"), record.contactTitle, { wide: true, multiline: true, rows: 2, max: 300 }), field('contactBody', t("Content", "联系页正文"), record.contactBody, { wide: true, multiline: true, rows: 3, max: 4000 }), field('launchedAt', t("Launched at", "运行计时起点"), record.launchedAt, { wide: true, max: 40, placeholder: t("Please enter launch date", "请填写运行计时起点"), hint: t("YYYY-MM-DDTHH:mm:ss+08:00 · Optional.", "YYYY-MM-DDTHH:mm:ss+08:00，可留空。") })); fragment.append(contact.section);
  const navigation = settingsSection(t("Navigation", "导航"), ''); const rows = element('div', 'navigation-rows wide');
  const updateOrder = () => { [...rows.children].forEach((row, index, all) => { row.querySelector('[data-move="up"]').disabled = index === 0; row.querySelector('[data-move="down"]').disabled = index === all.length - 1; }); };
  for (const item of record.navigation || []) {
    const row = element('div', 'navigation-row'); row.dataset.navigationId = item.id;
    const control = field(`nav.${item.id}`, item.id.toUpperCase(), item.label, { required: true, max: 40 }); control.querySelector('input').dataset.navigationLabel = '';
    const visible = checkboxField(`navVisible.${item.id}`, t("Visible", "显示"), item.visible); visible.querySelector('input').dataset.navigationVisible = '';
    const moves = element('div', 'row-actions');
    for (const [direction, label] of [['up', '↑'], ['down', '↓']]) { const button = element('button', 'button subtle', label); button.type = 'button'; button.dataset.move = direction; button.setAttribute('aria-label', `${direction === 'up' ? t("Move up", "上移") : t("Move down", "下移")} ${item.id}`); button.addEventListener('click', () => { moveRow(rows, row, direction); updateOrder(); markDirty(true); }); moves.append(button); }
    row.append(control, visible, moves); rows.append(row);
  }
  navigation.grid.append(rows); updateOrder(); fragment.append(navigation.section);
  const pages = settingsSection(t("Pages", "栏目文案"), '');
  for (const id of ['blog', 'library', 'friends']) { const group = element('div', 'page-settings-group wide'); group.append(element('h4', '', sectionLabel(id)), field(`pages.${id}.title`, t("Title", "标题"), record.pages?.[id]?.title, { required: true, max: 100 }), field(`pages.${id}.eyebrow`, t("Eyebrow", "上方小字"), record.pages?.[id]?.eyebrow, { max: 200 }), field(`pages.${id}.description`, t("Description", "说明"), record.pages?.[id]?.description, { multiline: true, rows: 2, max: 1000 })); pages.grid.append(group); } fragment.append(pages.section);
  const libraryTypes = settingsSection(t('Library categories', 'Library 分类'), t('Move entries before removing a category.', '删除分类前请先迁移条目。'));
  libraryTypes.grid.append(libraryTypeFields(record.libraryTypes || state.settings?.libraryTypes || [])); fragment.append(libraryTypes.section);
  const categories = settingsSection(t("Categories", "文章分类"), t("Move posts before removing a category.", "删除分类前请先迁移文章。")); const categoryRows = element('div', 'category-rows wide');
  const addCategory = item => {
    const row = element('div', 'category-row'); row.dataset.categoryRow = '';
    for (const [key, label, max] of [['id', t("ID", "分类 ID"), 80], ['label', t("Name", "名称"), 80], ['en', t("English name", "英文名称"), 100]]) { const control = field(`category.${key}`, label, item[key], { required: true, max, ...(key === 'id' ? { pattern: '[a-z0-9]+(-[a-z0-9]+)*', placeholder: t("Please enter category ID", "请填写分类 ID"), hint: t("Lowercase letters, numbers and hyphens.", "使用小写字母、数字和连字符。") } : {}) }); control.querySelector('input').dataset.categoryKey = key; row.append(control); }
    const remove = element('button', 'text-danger', t("Remove", "移除")); remove.type = 'button'; remove.setAttribute('aria-label', t(`Remove category ${item.label || ''}`, `移除分类 ${item.label || ''}`)); remove.addEventListener('click', () => { row.remove(); markDirty(true); }); row.append(remove); categoryRows.append(row);
  };
  (record.categories || []).forEach(addCategory); const add = element('button', 'button subtle add-category', t("+ Add category", "＋ 新增分类")); add.type = 'button'; add.addEventListener('click', () => { addCategory({ id: '', label: '', en: '' }); markDirty(true); categoryRows.lastElementChild.querySelector('input').focus(); }); categories.grid.append(categoryRows, add); fragment.append(categories.section);
  const footer = settingsSection(t("Footer", "页脚")); footer.grid.append(field('footerLabel', t("Label", "英文标识"), record.footerLabel, { max: 100 }), field('footerNote', t("Text", "页脚说明"), record.footerNote, { max: 300 })); fragment.append(footer.section);
  $('#fields').replaceChildren(fragment); updatePreviewLink();
  settingsPreviewCleanup?.(); settingsPreviewCleanup = mountSettingsPreview({ form, getValues: formValue, siteUrl: state.session.siteUrl });
}
function newRecord() {
  if (state.backupBusy || state.kind === 'backup') return;
  if (state.kind === 'media') { media.requestUpload(); return; }
  if (!state.session || state.busy || !mayLeave()) return; clearError();
  const date = new Date().toLocaleDateString('en-CA'); const suffix = Date.now().toString(36);
  let record;
  if (state.kind === 'blog') record = { id: `POST-${suffix}`, slug: '', title: '', summary: '', categoryId: state.session.categories[0]?.id || '', date, tags: [], readTime: 3, demo: false, draft: true, body: '' };
  else if (state.kind === 'library') {
    if (!state.session.libraryTypes.length) { message(t('Add a Library category in Settings first.', '请先在设置中添加 Library 分类。')); return; }
    record = { id: `item-${suffix}`, title: '', original: '', type: state.session.libraryTypes[0].id, typeLabel: '', creator: '', date, rating: '', cover: '', note: '', detail: '', article: null, tags: [], demo: false };
  }
  else record = { id: `friend-${crypto.randomUUID()}`, name: '', url: '', avatar: '', initials: '', description: '', label: '', kind: '', order: state.records.friends.length, visible: true, demo: false };
  edit(record); markDirty(true); form.elements.namedItem(state.kind === 'friends' ? 'name' : 'title').focus();
}
function formValue() {
  const values = Object.fromEntries(new FormData(form).entries()); let input;
  if (state.kind === 'settings') {
    input = {};
    for (const name of ['name', 'title', 'description', 'url', 'tagline', 'intro', 'eyebrow', 'footerNote', 'footerLabel', 'github', 'email', 'logo', 'favicon', 'orbitImage', 'defaultTheme', 'archiveSubtitle', 'archiveTitle', 'homeEdition', 'aboutEyebrow', 'aboutTitle', 'aboutBody', 'contactEyebrow', 'contactTitle', 'contactBody', 'launchedAt']) input[name] = values[name] || '';
    for (const name of ['showRSS', 'demo']) input[name] = form.elements.namedItem(name).checked;
    input.navigation = [...form.querySelectorAll('[data-navigation-id]')].map(row => ({ id: row.dataset.navigationId, label: row.querySelector('[data-navigation-label]').value, visible: row.querySelector('[data-navigation-visible]').checked }));
    input.pages = Object.fromEntries(['blog', 'library', 'friends'].map(id => [id, Object.fromEntries(['title', 'eyebrow', 'description'].map(key => [key, values[`pages.${id}.${key}`] || '']))]));
    input.categories = [...form.querySelectorAll('[data-category-row]')].map(row => Object.fromEntries([...row.querySelectorAll('[data-category-key]')].map(control => [control.dataset.categoryKey, control.value])));
    input.libraryTypes = [...form.querySelectorAll('[data-library-type-row]')].map(row => Object.fromEntries([...row.querySelectorAll('[data-library-type-key]')].map(control => [control.dataset.libraryTypeKey, control.value])));
    input.aboutHighlights = [...form.querySelectorAll('[data-about-highlight-row]')].map(row => Object.fromEntries([...row.querySelectorAll('[data-highlight-key]')].map(control => [control.dataset.highlightKey, control.value])));
  } else {
    input = values; input.demo = form.elements.namedItem('demo').checked;
    if (state.kind === 'friends') { input.id = state.current.id; input.order = Number(input.order); input.visible = form.elements.namedItem('visible').checked; }
    else { input.tags = (input.tags || '').split(/[,，]/).map(value => value.trim()).filter(Boolean); if (state.kind === 'blog') { input.readTime = Number(input.readTime); input.draft = form.elements.namedItem('draft').checked; } else input.article = input.article || null; }
  }
  if (state.current?.revision) input.revision = state.current.revision; return input;
}
async function refreshRecords() {
  const [blog, library, friends] = await Promise.all([api('/api/blog'), api('/api/library'), api('/api/friends')]); state.records = { blog, library, friends }; renderList();
}
async function refreshList() {
  if (!state.session || state.busy || state.refreshing) return;
  state.refreshing = true;
  const button = $('#refresh-records'); button.disabled = true; button.textContent = t("Refreshing…", "正在刷新…"); clearError();
  try {
    const session = await api('/api/session');
    await refreshRecords(); state.session = session;
    // Keep the current form and its revision intact, including unsaved changes.
    // Selecting a refreshed record still goes through mayLeave().
    renderList();
    message(state.dirty ? t("Refreshed. Unsaved changes are preserved.", "列表已刷新，当前未保存的修改仍保留。") : t("Refreshed.", "列表已刷新。选择内容可载入文件中的最新版本。"));
    await updatePublish();
  } catch (error) { alertError(error); }
  finally { state.refreshing = false; button.disabled = state.busy; button.textContent = t("Refresh", "刷新列表"); }
}
async function save(event) {
  event?.preventDefault(); if (state.busy || form.hidden || !state.current) return;
  const markdown = form.elements.namedItem('body');
  if (markdown?.hidden && !markdown.validity.valid) form.querySelector('[data-editor-mode=edit]').click();
  if (!form.reportValidity()) return; clearError(); setBusy(true);
  try {
    const input = formValue(); const exists = Boolean(state.current.revision);
    const result = await api(state.kind === 'settings' ? '/api/settings' : `/api/${state.kind}${exists ? `/${encodeURIComponent(state.current.id)}` : ''}`, state.kind === 'settings' || exists ? 'PUT' : 'POST', input);
    markDirty(false);
    if (state.kind === 'settings') { state.settings = result; applyIdentity(result); state.session = await api('/api/session'); $('#visit-site').href = state.session.siteUrl; }
    edit(result); await refreshRecords();
    if (recoverable?.kind === state.kind && (state.kind === 'settings' || recoverable.record.id === result.id)) clearRecovery();
    message(state.session.publish.enabled ? t("Saved. Publishing…", "已保存，正在发布更新。") : t("Saved.", "已保存，网站将自动更新。")); if (state.session.publish.enabled) await updatePublish();
  } catch (error) { alertError(error); } finally { setBusy(false); }
}
async function updatePublish() {
  const status = await api('/api/publish/status'); const messages = { idle: t("Ready", "就绪"), building: t("Building…", "正在构建…"), queued: t("Queued…", "等待发布…"), published: `${t('Published', '已发布')}${status.finishedAt ? ` · ${new Date(status.finishedAt).toLocaleTimeString(getLocale() === 'zh' ? 'zh-CN' : 'en-GB')}` : ''}`, failed: `${t('Publishing failed.', '发布失败。')} ${translateError(status.error || '')}` };
  const lines = element('div', 'publish-lines');
  lines.append(element('span', '', status.enabled ? messages[status.state] || t("Ready", "发布服务就绪") : t("Local preview", "本地预览")));
  const watch = status.watch;
  if (watch?.enabled) {
    const watchMessages = {
      starting: t("Connecting…", "正在连接内容目录…"),
      watching: status.enabled ? t("Auto publish", "自动发布") : t("Live reload", "实时更新"),
      settling: status.enabled ? t("Changes detected…", "已发现文件变化，正在等待写入完成后发布…") : t("Changes detected…", "已发现文件变化，正在等待写入完成；本地预览会自动更新。"),
      error: `${t('Watcher error:', '监听出错：')} ${translateError(watch.error || t('Check file permissions.', '请检查目录权限。'))}`,
      stopped: t("Watcher stopped", "内容目录监听已停止。")
    };
    const watchLine = element('span', `watch-status${watch.state === 'error' ? ' failed' : ''}`, watch.enabled ? watchMessages[watch.state] || t("Watcher active", "内容目录监听已启用。") : '');
    lines.append(watchLine);
  }
  $('#publish-status').replaceChildren(lines);
  state.publishBusy = status.state === 'building' || status.state === 'queued';
  $('#publish-status').classList.toggle('failed', status.state === 'failed' || watch?.state === 'error'); $('#publish-button').hidden = !status.enabled; $('#publish-button').disabled = state.backupBusy || state.publishBusy;
}
function updateSectionLabels() {
  const label = sectionLabel(state.kind);
  $('#page-title').textContent = label;
  $('#create-button').textContent = state.kind === 'media' ? t('+ Upload', '＋ 上传图片') : t(`+ New ${label}`, `＋ 新建${label}`);
  $('#list-label').textContent = t(`All ${label}`, `全部${label}`);
}
async function switchKind(kind) {
  if (!state.session || state.busy || state.backupBusy || kind === state.kind || !mayLeave()) return;
  const version = ++navigationVersion;
  settingsPreviewCleanup?.(); settingsPreviewCleanup = null;
  state.kind = kind; state.current = null; markDirty(false); clearError(); $('#search').value = '';
  for (const node of document.querySelectorAll('[data-kind]')) { const active = node.dataset.kind === kind; node.classList.toggle('active', active); if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); }
  updateSectionLabels();
  $('#create-button').hidden = kind === 'settings' || kind === 'backup'; $('#create-button').dataset.upload = String(kind === 'media');
  $('.content-grid').hidden = kind === 'media' || kind === 'backup'; $('.content-grid').classList.toggle('settings-mode', kind === 'settings'); $('.record-panel').hidden = kind === 'settings'; $('#media-panel').hidden = kind !== 'media'; $('#backup-panel').hidden = kind !== 'backup';
  form.hidden = true; $('#empty-editor').hidden = true;
  try {
    if (kind === 'backup') backup.render();
    else if (kind === 'media') await media.refresh();
    else if (kind === 'settings') { state.settings = await api('/api/settings'); if (version !== navigationVersion) return; editSettings(state.settings); }
    else { state.session = await api('/api/session'); await refreshRecords(); if (version !== navigationVersion) return; if (state.records[kind].length) edit(state.records[kind][0]); else $('#empty-editor').hidden = false; }
    if (version === navigationVersion) window.scrollTo(0, 0);
  } catch (error) { alertError(error); }
}
form.addEventListener('submit', save);
form.addEventListener('input', () => { markDirty(true); updatePreviewLink(); });
form.addEventListener('change', () => { markDirty(true); updatePreviewLink(); });
$('#create-button').addEventListener('click', newRecord); $('#search').addEventListener('input', renderList);
$('#refresh-records').addEventListener('click', refreshList);
document.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => switchKind(button.dataset.kind)));
$('#delete-button').addEventListener('click', () => { $('#delete-description').textContent = t(`Delete “${state.current.title || state.current.name}”?`, `删除「${state.current.title || state.current.name}」？`); $('#delete-dialog').showModal(); $('#cancel-delete').focus(); });
$('#cancel-delete').addEventListener('click', () => $('#delete-dialog').close());
$('#confirm-delete').addEventListener('click', async () => {
  if (state.busy) return; const button = $('#confirm-delete'); button.disabled = true; clearError(); setBusy(true);
  try { await api(`/api/${state.kind}/${encodeURIComponent(state.current.id)}`, 'DELETE', { revision: state.current.revision }); $('#delete-dialog').close(); markDirty(false); state.current = null; await refreshRecords(); if (state.records[state.kind].length) edit(state.records[state.kind][0]); else { form.hidden = true; $('#empty-editor').hidden = false; } message(t("Deleted.", "内容已删除。")); if (state.session.publish.enabled) await updatePublish(); }
  catch (error) { $('#delete-dialog').close(); alertError(error); } finally { button.disabled = false; setBusy(false); }
});
$('#publish-button').addEventListener('click', async () => { if (state.backupBusy) return; try { clearError(); await api('/api/publish', 'POST', {}); await updatePublish(); } catch (error) { alertError(error); } });
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!form.hidden && !document.querySelector('dialog[open]')) save(); } });
window.addEventListener('beforeunload', event => { if ((state.dirty || state.backupBusy) && !state.authRedirecting) { event.preventDefault(); } });
$('.wordmark').addEventListener('click', event => { if (state.backupBusy || !mayLeave()) event.preventDefault(); });

$('#restore-recovery').addEventListener('click', async () => {
  if (!recoverable || state.busy || state.backupBusy || !mayLeave()) return;
  const saved = recoverable;
  // A saved revision is kept so the backend still detects competing edits.
  if (saved.kind !== state.kind) { markDirty(false); await switchKind(saved.kind); }
  if (state.authRedirecting || state.kind !== saved.kind) return;
  edit(saved.record); markDirty(true); clearRecovery(); message(t("Recovered. Review before saving.", "已恢复上次未提交的修改，请检查后保存。"));
});
$('#discard-recovery').addEventListener('click', () => { if (state.backupBusy) return; clearRecovery(); message(t("Recovery discarded.", "已清除这次暂存。")); });
$('#logout-button').addEventListener('click', async () => {
  if (state.busy || state.backupBusy || state.authRedirecting) return;
  if (!preserveRecovery()) { alertError(new Error(t("Unable to preserve changes. Save or copy your work before signing out.", "无法暂存未提交的修改，请先保存或复制内容，再退出登录。"))); return; }
  const button = $('#logout-button'); button.disabled = true;
  try { await api('/api/auth/logout', 'POST', {}); state.authRedirecting = true; window.location.assign('/login'); }
  catch (error) { alertError(error); button.disabled = false; }
});

initAccount({
  beforeOpen: () => Boolean(state.session) && state.session.authEnabled !== false && !state.busy && !state.backupBusy && !state.authRedirecting,
  afterUpdate: result => {
    if (state.session) { state.session.csrf = result.csrf; state.session.username = result.username; }
    message(t("Account updated. Other sessions signed out.", "账号已更新，其他登录会话已退出。"));
  },
  onUnauthorized: handleUnauthorized,
});


window.addEventListener('admin:language-change', () => {
  const y = window.scrollY;
  const focused = document.activeElement;
  const name = focused?.getAttribute('name');
  const selection = focused && 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd] : null;
  const dirty = state.dirty;
  const controls = [...form.querySelectorAll('input[name], select[name], textarea[name]')].map(control => ({ name: control.name, value: control.value, checked: control.checked }));
  const previewing = Boolean(form.elements.namedItem('body')?.hidden);
  const snapshot = state.current && !form.hidden ? { ...state.current, ...formValue() } : null;
  if (state.kind === 'backup') backup.render();
  if (snapshot) {
    edit(snapshot);
    const restored = [...form.querySelectorAll('input[name], select[name], textarea[name]')];
    controls.forEach((saved, index) => {
      const control = restored[index];
      if (control?.name === saved.name) {
        control.value = saved.value;
        if (control.type === 'checkbox') control.checked = saved.checked;
      }
    });
    if (previewing) form.querySelector('.editor-tabs button:last-child')?.click();
    markDirty(dirty);
  }
  if (state.session) {
    updateSectionLabels();
    document.title = `${t('CMS', '内容工作台')} · ${$('#workspace-name').textContent}`;
    renderList(); setBusy(state.busy); updatePublish().catch(alertError);
  }
  const target = name && [...form.elements].find(control => control.name === name);
  target?.focus({ preventScroll: true });
  if (selection && target?.setSelectionRange && selection[0] !== null) target.setSelectionRange(...selection);
  window.scrollTo({ top: y, behavior: 'instant' });
});

try {
  const auth = await api('/api/auth/status'); applyIdentity(auth);
  if (!auth.authenticated) { handleUnauthorized(); throw Object.assign(new Error(t("Sign in to continue.", "请登录后继续。")), { handled: true }); }
  state.session = await api('/api/session'); $('#visit-site').href = state.session.siteUrl;
  $('#account-button').hidden = state.session.authEnabled === false;
  await refreshRecords(); await updatePublish(); media.refresh().catch(alertError);
  if (state.records.blog.length) edit(state.records.blog[0]);
  readRecovery();
  try {
    const restoredBackup = sessionStorage.getItem(restoredBackupKey);
    if (restoredBackup) {
      sessionStorage.removeItem(restoredBackupKey); clearRecovery();
      await switchKind('backup'); backup.showRestored(JSON.parse(restoredBackup));
    }
  } catch {}
  if (state.session.publish.enabled || state.session.publish.watch?.enabled) setInterval(() => { if (!state.authRedirecting) updatePublish().catch(alertError); }, 3000);
} catch (error) { alertError(error); $('#publish-status').textContent = t("Content unavailable. Check the error and refresh.", "内容库暂时不可用，请查看上方提示后刷新。"); }
