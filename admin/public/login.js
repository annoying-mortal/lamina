import { siteImageUrl } from './ui.js';
import { t, translateError } from './i18n.js';
const $ = selector => document.querySelector(selector);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let authState;
let inFlight = false;
let textVersion = 0;
const delay = duration => new Promise(resolve => setTimeout(resolve, duration));
function localizedText(selector, en, zh) {
  const node = $(selector);
  node.dataset.en = en;
  node.dataset.zh = zh;
  node.textContent = t(en, zh);
}
async function terminal(text, immediate = false) {
  const version = ++textVersion;
  const target = $('#terminal-message');
  if (immediate || reducedMotion.matches) { target.textContent = text; return; }
  target.textContent = '';
  for (const letter of text) {
    if (version !== textVersion) return;
    target.textContent += letter;
    await delay(22);
  }
}
function errorMessage(text) {
  $('#login-error').textContent = translateError(text);
  $('#login-error').hidden = !text;
}
function setBusy(value) {
  inFlight = value;
  $('#login-fields').disabled = value;
  document.body.dataset.state = value ? 'verifying' : 'ready';
}
function updatePasswordToggle() {
  const shown = $('#password').type === 'text';
  const label = shown ? t('Hide password', '隐藏密码') : t('Show password', '显示密码');
  $('#show-password').setAttribute('aria-label', label);
  $('#show-password').title = label;
  $('#show-password').setAttribute('aria-pressed', String(shown));
}
function renderAuthLabels() {
  if (!authState) return;
  document.title = `${authState.configured ? t('Sign in', '登录') : t('Create account', '创建账号')} · ${authState.name || t('Workspace', '工作台')}`;
  document.querySelectorAll('[data-site-name]').forEach(node => { node.textContent = authState.name || t('Enter site name', '请填写站点名称'); });
  $('#emblem-label').textContent = authState.archiveTitle || authState.name || t('Enter archive title', '请填写档案标题');
  localizedText('#login-title', authState.configured ? 'Sign in' : 'Create account', authState.configured ? '登录' : '创建账号');
  $('#login-description').hidden = authState.configured;
  localizedText('#login-description', 'Create the first administrator account.', '创建首个管理员账号。');
  $('#username-hint').hidden = authState.configured;
  if (!inFlight && document.body.dataset.state !== 'authorized') localizedText('#submit-label', authState.configured ? 'Sign in' : 'Create account', authState.configured ? '登录' : '创建账号');
}
function showStatus(state) {
  authState = state;
  if (state.authenticated) { location.replace('/'); return; }
  const logo = $('#identity-logo');
  const logoUrl = siteImageUrl(state.orbitImage, state.siteUrl);
  logo.hidden = true;
  logo.onload = () => { logo.hidden = false; };
  logo.onerror = () => { logo.hidden = true; };
  if (logoUrl) logo.src = logoUrl; else logo.removeAttribute('src');
  if (state.siteUrl) {
    try { const url = new URL(state.siteUrl); if (['http:', 'https:'].includes(url.protocol)) $('#return-site').href = url.href; } catch {}
  }
  window.FieldTheme?.setDefault(state.defaultTheme || 'system');
  $('#confirm-field').hidden = state.configured;
  $('#confirm-password').required = !state.configured;
  $('#password-hint').hidden = state.configured;
  $('#setup-token-field').hidden = !state.setupTokenRequired;
  $('#setup-token').required = Boolean(state.setupTokenRequired);
  $('#password').autocomplete = state.configured ? 'current-password' : 'new-password';
  $('#password').minLength = state.configured ? 1 : 12;
  $('#session-status').textContent = state.configured ? 'SESSION LOCKED' : 'IDENTITY NOT REGISTERED';
  const expired = new URLSearchParams(location.search).has('expired');
  localizedText('#login-status', expired ? 'Session expired. Sign in to restore your draft.' : '', expired ? '会话已结束，请登录以恢复草稿。' : '');
  $('#retry-connection').hidden = true;
  setBusy(false);
  renderAuthLabels();
  terminal(state.configured ? 'IDENTITY VERIFICATION' : 'IDENTITY INITIALIZATION');
}
async function connect() {
  $('#retry-connection').hidden = true;
  errorMessage('');
  localizedText('#login-status', 'Connecting…', '连接中…');
  try {
    const response = await fetch('/api/auth/status', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || t('Connection unavailable.', '无法连接。'));
    showStatus(result);
  } catch (error) {
    document.body.dataset.state = 'error';
    terminal('CONNECTION UNAVAILABLE', true);
    errorMessage(error.message || t('Connection failed. Try again.', '连接失败，请重试。'));
    localizedText('#login-status', '', '');
    $('#retry-connection').hidden = false;
  }
}
$('#retry-connection').addEventListener('click', connect);
$('#show-password').addEventListener('click', () => {
  $('#password').type = $('#password').type === 'password' ? 'text' : 'password';
  updatePasswordToggle();
});
window.addEventListener('admin:language-change', () => {
  renderAuthLabels();
  updatePasswordToggle();
});
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (inFlight || !authState) return;
  errorMessage('');
  const username = $('#username').value;
  const password = $('#password').value;
  if (!authState.configured && password !== $('#confirm-password').value) {
    errorMessage(t('Passwords do not match.', '两次密码不一致。')); $('#confirm-password').focus(); return;
  }
  setBusy(true);
  terminal('REQUEST RECEIVED');
  localizedText('#login-status', 'Verifying…', '验证中…');
  let processTimer = setTimeout(() => terminal('START PROCESSING…'), 650);
  try {
    const response = await fetch(authState.configured ? '/api/auth/login' : '/api/auth/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': authState.csrf }, body: JSON.stringify({ username, password, ...(!authState.configured && authState.setupTokenRequired ? { setupToken: $('#setup-token').value } : {}) }),
    });
    const result = await response.json();
    clearTimeout(processTimer);
    if (!response.ok) {
      if (response.status === 409 || response.status === 403) {
        const fresh = await fetch('/api/auth/status', { cache: 'no-store' });
        if (fresh.ok) showStatus(await fresh.json());
      }
      throw new Error(result.error || t('Sign-in failed. Try again.', '登录失败，请重试。'));
    }
    if (!result.authenticated) throw new Error(t('Session not confirmed. Try again.', '会话未确认，请重试。'));
    // Never show the successful ID sequence until the server accepts the credentials.
    $('#password').value = ''; $('#confirm-password').value = ''; $('#setup-token').value = '';
    await terminal(`ID CONFIRMED : ${result.username}`);
    $('#session-status').textContent = 'SESSION AUTHORIZED';
    localizedText('#login-status', 'Opening workspace…', '进入工作台…');
    localizedText('#submit-label', 'Authorized', '已授权');
    document.body.dataset.state = 'authorized';
    await delay(reducedMotion.matches ? 0 : 800);
    location.replace('/');
  } catch (error) {
    clearTimeout(processTimer);
    setBusy(false);
    document.body.dataset.state = 'error';
    terminal('ACCESS DENIED', true);
    errorMessage(error.message || t('Sign-in failed. Try again.', '登录失败，请重试。'));
    localizedText('#login-status', '', '');
    $('#password').focus();
  }
});
updatePasswordToggle();
connect();
