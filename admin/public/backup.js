import { t, getLocale, translateError } from './i18n.js';
import { element } from './ui.js';

const maxArchiveSize = 256 * 1024 * 1024;
const sizeLabel = size => `${(size / 1024 / 1024).toFixed(1)} MiB`;

export function createBackupTools({ api, onBusy, onRestored, clearError }) {
  const panel = document.querySelector('#backup-panel');
  const input = document.querySelector('#backup-upload-input');
  const dialog = element('dialog', 'backup-dialog');
  dialog.id = 'backup-restore-dialog';
  dialog.setAttribute('aria-labelledby', 'backup-restore-title');
  document.body.append(dialog);
  let file = null;
  let preview = null;
  let busy = '';
  let status = '';
  let error = '';
  let download = null;
  let rollbackId = '';
  let expiryTimer;

  function button(id, text, action, className = 'button subtle') {
    const node = element('button', className, text);
    node.id = id; node.type = 'button'; node.disabled = Boolean(busy);
    node.addEventListener('click', action);
    return node;
  }
  function setBusy(value) { busy = value; onBusy(Boolean(value)); render(); }
  function isExpired() { return Boolean(preview?.expiresAt && Date.parse(preview.expiresAt) <= Date.now()); }
  function reset() {
    if (busy) return;
    file = null; preview = null; status = ''; error = ''; input.value = '';
    clearTimeout(expiryTimer); render();
  }
  function showError(failure) {
    status = '';
    if (!failure.handled) error = failure.message || String(failure);
  }
  function renderDialog() {
    const content = element('div', 'dialog-content');
    content.append(element('span', 'eyebrow', t('RESTORE BACKUP', '恢复备份')));
    const title = element('h2', '', t('Replace this site’s content?', '替换当前站点内容？'));
    title.id = 'backup-restore-title';
    content.append(title, element('p', '', t('This replaces site settings, Blog, Library and Friends with the inspected backup, and restores its images.', '此操作将使用已检查的备份替换站点设置、文章、收藏和友链，并恢复备份中的图片。')));
    content.append(element('p', 'muted', t('A snapshot of the original files is saved on the server for manual recovery. Your administrator account and password stay unchanged.', '替换前会在服务器保存原始文件快照，供手动回滚恢复。管理员账号与密码保持不变。')));
    const actions = element('div', 'dialog-actions');
    actions.append(button('cancel-backup-restore', t('Cancel', '取消'), () => dialog.close()));
    const restore = button('confirm-backup-restore', busy === 'restore' ? t('Restoring…', '正在恢复…') : t('Replace & restore', '替换并恢复'), restoreBackup, 'button danger');
    restore.disabled = Boolean(busy) || !preview || isExpired();
    actions.append(restore); content.append(actions); dialog.replaceChildren(content);
  }
  function renderSummary() {
    const result = element('div', 'backup-preview');
    result.id = 'backup-preview';
    const title = element('h3', '', t('Ready to restore', '可以恢复'));
    title.id = 'backup-preview-title'; title.tabIndex = -1;
    result.append(title);
    if (preview.createdAt) result.append(element('p', 'backup-meta', t('Created · ', '创建时间 · ') + new Date(preview.createdAt).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-GB')));
    const counts = element('dl', 'backup-counts');
    for (const [key, label] of [['blog', t('Blog', '文章')], ['library', t('Library', '收藏')], ['friends', t('Friends', '友链')], ['images', t('Images', '图片')]]) {
      const pair = element('div'); pair.append(element('dt', '', label), element('dd', '', String(preview.summary?.[key] ?? 0))); counts.append(pair);
    }
    result.append(counts);
    if (preview.warnings?.length) {
      const warnings = element('div', 'backup-warnings');
      warnings.append(element('h4', '', t('Review before restoring', '恢复前请检查')));
      const list = element('ul');
      for (const warning of preview.warnings) list.append(element('li', '', translateError(typeof warning === 'string' ? warning : warning.message || String(warning))));
      warnings.append(list); result.append(warnings);
    }
    const expired = isExpired();
    result.append(element('p', 'backup-meta', expired ? t('This preview expired. Inspect the ZIP again before restoring.', '此预览已过期，请重新检查 ZIP 后再恢复。') : t('Inspecting has not changed your site. Restore replaces the current content.', '检查不会修改站点。恢复将替换当前内容。')));
    if (preview.expiresAt && !expired) result.append(element('p', 'backup-meta', t('Preview expires · ', '预览有效期至 · ') + new Date(preview.expiresAt).toLocaleTimeString(getLocale() === 'zh' ? 'zh-CN' : 'en-GB')));
    const actions = element('div', 'backup-actions');
    const restore = button('backup-restore-button', t('Restore backup →', '恢复备份 →'), () => {
      if (busy || !preview) return;
      if (isExpired()) { render(); return; }
      renderDialog(); dialog.showModal(); document.querySelector('#cancel-backup-restore').focus();
    }, 'button danger');
    restore.disabled = Boolean(busy) || expired;
    actions.append(restore, button('backup-cancel-button', t('Cancel import', '取消导入'), reset));
    result.append(actions); return result;
  }
  function render() {
    const intro = element('p', 'backup-intro', t('Keep a portable copy of your site, or restore one when moving to a new installation.', '保存一份可迁移的站点备份，也可以在迁移到新环境时导入恢复。'));
    const exportSection = element('section', 'backup-section');
    const exportHeading = element('div', 'backup-heading');
    exportHeading.append(element('span', 'eyebrow', '01'), element('h2', '', t('Export', '导出备份')));
    const exportBody = element('div', 'backup-body');
    exportBody.append(element('p', '', t('One ZIP with site settings, Blog (including drafts), Library, Friends and referenced images.', '一个 ZIP 文件，包含站点设置、文章（含草稿）、收藏、友链及引用的图片。')));
    exportBody.append(element('p', 'muted', t('Available remote images are included. If an image cannot be downloaded, its original URL is retained with a warning. Accounts, passwords and fonts are excluded.', '可下载的外链图片会一并打包；无法下载的图片保留原始地址并给出提示。不包含管理员账号、密码或字体。')));
    const exportActions = element('div', 'backup-actions');
    exportActions.append(button('backup-export-button', busy === 'export' ? t('Preparing ZIP…', '正在准备 ZIP…') : t('Download ZIP ↓', '下载 ZIP ↓'), exportBackup));
    if (download) {
      const link = element('a', 'button subtle', t('Save ZIP again', '重新保存 ZIP')); link.id = 'backup-download-link'; link.href = download.url; link.download = download.name; exportActions.append(link);
    }
    exportBody.append(exportActions);
    if (download?.warningCount > 0) exportBody.append(element('p', 'backup-meta', t(`The ZIP contains ${download.warningCount} image warning(s). Inspect it below to review them.`, `ZIP 包含 ${download.warningCount} 条图片提示，可在下方检查备份以查看详情。`)));
    exportSection.append(exportHeading, exportBody);
    const importSection = element('section', 'backup-section');
    const importHeading = element('div', 'backup-heading');
    importHeading.append(element('span', 'eyebrow', '02'), element('h2', '', t('Import', '导入备份')));
    const importBody = element('div', 'backup-body');
    importBody.append(element('p', '', t('Choose a backup ZIP to inspect its contents before restoring.', '选择备份 ZIP，先检查内容，再确认恢复。')));
    importBody.append(element('p', 'muted', t('Up to 256 MiB. Restoring replaces your current settings and content; a rollback snapshot is saved automatically.', '最大 256 MiB。恢复会替换当前设置和内容；替换前自动保存回滚快照。')));
    const importActions = element('div', 'backup-actions');
    importActions.append(button('backup-choose-button', file || preview ? t('Choose another ZIP', '更换 ZIP') : t('Choose ZIP ↑', '选择 ZIP ↑'), () => { if (!busy) input.click(); }));
    if (file) {
      importActions.append(button('backup-inspect-button', busy === 'inspect' ? t('Inspecting…', '正在检查…') : t('Inspect ZIP →', '检查 ZIP →'), inspectBackup));
      if (!preview) importActions.append(button('backup-clear-button', t('Cancel', '取消'), reset));
    }
    importBody.append(importActions);
    if (file) importBody.append(element('p', 'backup-filename', `${file.name} · ${sizeLabel(file.size)}`));
    if (preview) importBody.append(renderSummary());
    importSection.append(importHeading, importBody);
    const feedback = element('div', 'backup-feedback');
    const progress = element('p', 'backup-status'); progress.id = 'backup-status'; progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
    const messages = {
      export: t('Collecting content and images. Keep this page open…', '正在收集内容和图片，请保持此页面打开…'),
      inspect: t('Uploading and checking the archive. Keep this page open…', '正在上传并检查备份，请保持此页面打开…'),
      restore: t('Saving a rollback snapshot and restoring your site. Keep this page open…', '正在保存回滚快照并恢复站点，请保持此页面打开…'),
      downloaded: t('Your ZIP is ready. If the download did not start, use “Save ZIP again”.', 'ZIP 已准备好；若未开始下载，请点击“重新保存 ZIP”。'),
      restored: t('Backup restored. Settings, content and images have been refreshed.', '备份已恢复，站点设置、内容与图片已刷新。'),
    };
    progress.textContent = messages[busy || status] || ''; progress.hidden = !progress.textContent;
    feedback.append(progress);
    if (status === 'restored' && rollbackId) feedback.append(element('p', 'backup-meta', t('Manual recovery snapshot in the server’s private backups directory · ', '手动回滚快照已保存在服务器的私密 backups 目录 · ') + rollbackId));
    if (error) { const alert = element('p', 'backup-error', translateError(error)); alert.id = 'backup-error'; alert.setAttribute('role', 'alert'); feedback.append(alert); }
    panel.setAttribute('aria-busy', String(Boolean(busy)));
    panel.replaceChildren(intro, feedback, exportSection, importSection);
    if (dialog.open) renderDialog();
  }
  async function exportBackup() {
    if (busy) return;
    clearError(); error = ''; status = ''; setBusy('export');
    try {
      const result = await api('/api/backup/export', 'GET', undefined, { response: 'blob' });
      if (download) URL.revokeObjectURL(download.url);
      download = { url: URL.createObjectURL(result.blob), name: result.filename || 'site-backup.zip', warningCount: result.warningCount || 0 }; status = 'downloaded';
    } catch (failure) { showError(failure); }
    finally { setBusy(''); }
    if (status === 'downloaded') document.querySelector('#backup-download-link')?.click();
  }
  async function inspectBackup() {
    if (busy || !file) return;
    clearError(); error = ''; status = ''; preview = null; clearTimeout(expiryTimer); setBusy('inspect');
    try {
      preview = await api('/api/backup/inspect', 'POST', file, { raw: true, contentType: 'application/zip', headers: { 'X-File-Name': encodeURIComponent(file.name) } });
      if (preview.expiresAt) expiryTimer = setTimeout(() => render(), Math.max(0, Math.min(2147483647, Date.parse(preview.expiresAt) - Date.now() + 50)));
    } catch (failure) { showError(failure); }
    finally { setBusy(''); }
    document.querySelector('#backup-preview-title')?.focus({ preventScroll: true });
  }
  async function restoreBackup() {
    if (busy || !preview || isExpired()) { render(); return; }
    const token = preview.token;
    clearError(); error = ''; status = ''; dialog.close(); setBusy('restore');
    try {
      const result = await api('/api/backup/restore', 'POST', { token });
      preview = null; file = null; clearTimeout(expiryTimer); status = 'restored';
      setBusy(''); onRestored(result);
    } catch (failure) { preview = null; clearTimeout(expiryTimer); showError(failure); setBusy(''); }
  }
  input.addEventListener('change', () => {
    const selected = input.files[0]; input.value = '';
    if (busy || !selected) return;
    reset(); clearError();
    if (!/\.zip$/i.test(selected.name)) error = t('Choose a .zip backup file.', '请选择 .zip 备份文件。');
    else if (!selected.size) error = t('The selected ZIP is empty.', '所选 ZIP 文件为空。');
    else if (selected.size > maxArchiveSize) error = t('The ZIP exceeds 256 MiB.', 'ZIP 文件超过 256 MiB。');
    else file = selected;
    render(); document.querySelector('#backup-inspect-button')?.focus();
  });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  window.addEventListener('pagehide', () => { if (download) URL.revokeObjectURL(download.url); });
  return { render, showRestored(result) { status = 'restored'; rollbackId = result?.rollbackId || ''; render(); } };
}
