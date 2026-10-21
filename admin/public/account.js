import { t, translateError } from './i18n.js';
export function initAccount({ beforeOpen = () => true, afterUpdate = () => {}, onUnauthorized = () => {} } = {}) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#account-dialog');
  const form = $('#account-form');
  const fields = $('#account-fields');
  const closeButton = $('#close-account');
  const username = $('#account-username');
  const currentPassword = $('#account-current-password');
  const newPassword = $('#account-new-password');
  const confirmPassword = $('#account-confirm-password');
  let csrf = '';
  let ready = false;
  let saving = false;
  let requestVersion = 0;

  function showError(message = '') {
    $('#account-error').textContent = translateError(message);
    $('#account-error').hidden = !message;
  }
  function status(en, zh) {
    const node = $('#account-status');
    node.dataset.en = en; node.dataset.zh = zh;
    node.textContent = t(en, zh);
  }
  function clearCredentials() {
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
  }
  function close() {
    if (saving) return;
    clearCredentials();
    if (dialog.open) dialog.close();
  }
  function sessionExpired() {
    saving = false;
    closeButton.disabled = false;
    close();
    onUnauthorized();
  }
  async function open() {
    if (dialog.open || !beforeOpen()) return;
    const version = ++requestVersion;
    form.reset();
    clearCredentials();
    showError();
    ready = false;
    fields.disabled = true;
    $('#account-current-username').textContent = '—';
    status('Loading…', '读取中…');
    dialog.showModal();
    try {
      const response = await fetch('/api/account', { cache: 'no-store' });
      const result = await response.json();
      if (version !== requestVersion || !dialog.open) return;
      if (response.status === 401) { sessionExpired(); return; }
      if (!response.ok) throw new Error(result.error || t('Could not load account. Close and try again.', '无法读取账号，请关闭后重试。'));
      csrf = result.csrf;
      username.value = result.username;
      $('#account-current-username').textContent = result.username;
      status('', '');
      ready = true;
      fields.disabled = false;
      username.focus();
    } catch (error) {
      if (version !== requestVersion || !dialog.open) return;
      status('', '');
      showError(error.message || t('Connection failed. Close and try again.', '连接失败，请关闭后重试。'));
    }
  }
  $('#account-button').addEventListener('click', open);
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    ++requestVersion;
    clearCredentials();
    username.value = '';
    csrf = '';
    ready = false;
    fields.disabled = true;
    showError();
  });
  dialog.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      event.stopPropagation();
      if (ready && !saving) form.requestSubmit();
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    event.stopPropagation();
    if (!ready || saving) return;
    showError();
    if (newPassword.value !== confirmPassword.value) {
      showError(t('New passwords do not match.', '两次新密码不一致。'));
      confirmPassword.focus();
      return;
    }
    saving = true;
    fields.disabled = true;
    closeButton.disabled = true;
    status('Saving…', '保存中…');
    try {
      const response = await fetch('/api/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          username: username.value,
          currentPassword: currentPassword.value,
          ...(newPassword.value ? { newPassword: newPassword.value } : {}),
        }),
      });
      const result = await response.json();
      if (response.status === 401) { sessionExpired(); return; }
      if (!response.ok) throw new Error(result.error || t('Could not save account. Try again.', '账号保存失败，请重试。'));
      csrf = result.csrf;
      clearCredentials();
      afterUpdate(result);
      saving = false;
      close();
    } catch (error) {
      status('', '');
      showError(error.message || t('Connection failed. Try again.', '连接失败，请重试。'));
      fields.disabled = false;
      currentPassword.value = '';
      currentPassword.focus();
    } finally {
      saving = false;
      closeButton.disabled = false;
      fields.disabled = !ready;
    }
  });
  return { open, close };
}
