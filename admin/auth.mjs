import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, link, unlink, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const derive = promisify(scrypt);
const SESSION_COOKIE = 'field_admin_session';
const BOOTSTRAP_COOKIE = 'field_admin_bootstrap';
const random = () => randomBytes(32).toString('hex');
const LOGIN_ERROR = '无法登录，请检查用户名和密码或稍后重试。';
const validUsername = username => typeof username === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(username);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function cookies(req) {
  const result = new Map();
  for (const pair of (req.headers.cookie || '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator > 0) result.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  return result;
}
function sameToken(provided, expected) {
  return typeof provided === 'string' && /^[a-f0-9]{64}$/.test(provided) && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
function isLoopback(address) {
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}
function isPrivate(address) {
  const ip = address?.replace(/^::ffff:/, '') || '';
  const parts = ip.split('.').map(Number);
  return (parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)))
    || /^(?:fc|fd)[0-9a-f]{2}:/i.test(ip);
}

/** Authentication is mandatory unless createServer explicitly disables it for a test fixture. */
export function createAuth({ authDir, now = Date.now, sessionTtlMs = 12 * 60 * 60 * 1000, bootstrapTtlMs = 30 * 60 * 1000, maxAttempts = 6, rateWindowMs = 15 * 60 * 1000, secureCookies = false, loopbackPublished = false, allowRemoteSetup = false } = {}) {
  const directory = resolve(authDir);
  const file = join(directory, 'auth.json');
  const setupTokenFile = join(directory, 'setup-token');
  const sessions = new Map();
  const bootstraps = new Map();
  const attempts = new Map();
  let authQueue = Promise.resolve();
  const serialize = action => {
    const task = authQueue.then(action);
    authQueue = task.catch(() => {});
    return task;
  };
  async function config() {
    let value;
    try { value = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; fail(503, '管理员凭据暂时不可用，请检查后台日志或恢复凭据备份。'); }
    if (!value || !((value.version === 1 && value.username === 'admin') || (value.version === 2 && validUsername(value.username))) || value.algorithm !== 'scrypt' || value.N !== 32768 || value.r !== 8 || value.p !== 1 || !/^[a-f0-9]{64}$/.test(value.salt) || !/^[a-f0-9]{128}$/.test(value.hash)) fail(503, '管理员凭据暂时不可用，请检查后台日志或恢复凭据备份。');
    return value;
  }
  async function setupToken() {
    if (await config()) return null;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try { await writeFile(setupTokenFile, random() + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    let value;
    try { value = (await readFile(setupTokenFile, 'utf8')).trim(); }
    catch (error) { if (error.code === 'ENOENT' && await config()) return null; throw error; }
    if (!/^[a-f0-9]{64}$/.test(value)) fail(503, '初始化令牌不可用，请检查管理员凭据目录。');
    // A simultaneous setup may have completed while this request created the token.
    if (await config()) await unlink(setupTokenFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return value;
  }
  function cookie(req, res, name, value, ttl) {
    const secure = secureCookies || Boolean(req.socket.encrypted);
    const header = `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(ttl / 1000))}${secure ? '; Secure' : ''}`;
    const previous = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [String(previous)] : []), header]);
  }
  function sweep(map) {
    for (const [key, value] of map) if (value.expiresAt <= now()) map.delete(key);
    while (map.size > 1000) map.delete(map.keys().next().value);
  }
  function session(req) {
    sweep(sessions);
    const key = cookies(req).get(SESSION_COOKIE);
    const value = key && sessions.get(key);
    // A late response from an old session must not clear a freshly rotated browser cookie.
    return value ? { ...value, key } : null;
  }
  function bootstrap(req, res) {
    sweep(bootstraps);
    const key = cookies(req).get(BOOTSTRAP_COOKIE);
    const existing = key && bootstraps.get(key);
    if (existing) return existing;
    const value = { csrf: random(), expiresAt: now() + bootstrapTtlMs };
    const token = random(); bootstraps.set(token, value);
    cookie(req, res, BOOTSTRAP_COOKIE, token, bootstrapTtlMs);
    return value;
  }
  function requireBootstrap(req) {
    sweep(bootstraps);
    const value = bootstraps.get(cookies(req).get(BOOTSTRAP_COOKIE));
    if (!value || !sameToken(req.headers['x-csrf-token'], value.csrf)) fail(403, '登录页面已过期，请刷新后重试。');
    return value;
  }
  function requireSession(req, _res) {
    const value = session(req);
    if (!value) fail(401, '登录已过期，请重新登录。');
    return value;
  }
  function requireCsrf(req, value) {
    if (!sameToken(req.headers['x-csrf-token'], value.csrf)) fail(403, '安全令牌已失效，请刷新后台后重试。');
  }
  function consumeAttempt(req) {
    sweep(attempts);
    const key = req.socket.remoteAddress || 'unknown';
    for (const [id, limit] of [[key, maxAttempts], ['all', maxAttempts * 5]]) {
      let value = attempts.get(id);
      if (!value) { value = { count: 0, expiresAt: now() + rateWindowMs }; attempts.set(id, value); }
      if (value.count >= limit) fail(429, LOGIN_ERROR);
      value.count++;
    }
  }
  function grant(req, res, username) {
    attempts.delete(req.socket.remoteAddress || 'unknown');
    attempts.delete('all');
    const oldKey = cookies(req).get(SESSION_COOKIE); if (oldKey) sessions.delete(oldKey);
    const bootstrapKey = cookies(req).get(BOOTSTRAP_COOKIE); if (bootstrapKey) bootstraps.delete(bootstrapKey);
    const key = random(); const value = { username, csrf: random(), expiresAt: now() + sessionTtlMs };
    sweep(sessions); sessions.set(key, value);
    cookie(req, res, SESSION_COOKIE, key, sessionTtlMs); cookie(req, res, BOOTSTRAP_COOKIE, '', 0);
    return { authenticated: true, username, csrf: value.csrf };
  }
  async function hash(password, salt) {
    return derive(password, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  }
  function validPassword(password) { return typeof password === 'string' && Array.from(password).length >= 12 && Array.from(password).length <= 128; }
  async function status(req, res) {
    const value = session(req);
    const credentials = await config();
    if (!credentials) await setupToken();
    return { configured: Boolean(credentials), authenticated: Boolean(value), ...(value ? { username: value.username } : {}), setupTokenRequired: !credentials && !isLoopback(req.socket.remoteAddress), csrf: value?.csrf || bootstrap(req, res).csrf };
  }
  async function saveCredentials(value, exclusive = false) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temp = join(directory, `.${random()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      if (exclusive) {
        try { await link(temp, file); }
        catch (error) { if (error.code === 'EEXIST') fail(409, '管理员已完成初始化，请使用登录入口。'); throw error; }
      } else await rename(temp, file);
    } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  function setup(req, res, input) {
    return serialize(async () => {
      requireBootstrap(req);
      const peer = req.socket.remoteAddress;
      const localBridge = loopbackPublished && isPrivate(peer) && /^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(req.headers.host || '');
      // Public initialization is an explicit TLS deployment option, never a default.
      // Non-loopback requests still need the private, single-use terminal token below.
      const remoteSetup = allowRemoteSetup && secureCookies && req.headers.origin === `https://${req.headers.host}`;
      if (!isLoopback(peer) && !localBridge && !remoteSetup) fail(403, '首次初始化仅允许从本机访问，或使用已启用的 HTTPS 初始化入口。');
      if (await config()) fail(409, '管理员已完成初始化，请使用登录入口。');
      if (!isLoopback(peer)) {
        const expected = await setupToken();
        if (!expected) fail(409, '管理员已完成初始化，请使用登录入口。');
        if (!sameToken(input?.setupToken, expected)) fail(403, '初始化令牌不正确，请在本机 Docker 终端获取令牌后重试。');
      }
      consumeAttempt(req);
      if (!validUsername(input?.username)) fail(400, '用户名需为 3–32 位，以英文字母或数字开头，仅允许字母、数字、点、下划线和连字符。');
      if (!validPassword(input?.password)) fail(400, '密码需为 12–128 个字符，允许空格和中文。');
      const salt = random();
      const derived = await hash(input.password, salt);
      const value = { version: 2, username: input.username, algorithm: 'scrypt', N: 32768, r: 8, p: 1, salt, hash: derived.toString('hex'), createdAt: new Date(now()).toISOString() };
      await saveCredentials(value, true);
      await unlink(setupTokenFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
      return grant(req, res, value.username);
    });
  }
  function login(req, res, input) {
    return serialize(async () => {
      requireBootstrap(req); consumeAttempt(req);
      const value = await config();
      // Derive even for invalid usernames and unconfigured accounts; do not reveal which credential failed.
      const password = validPassword(input?.password) ? input.password : '';
      const derived = await hash(password, value?.salt || '00'.repeat(32));
      const matchesHash = timingSafeEqual(derived, Buffer.from(value?.hash || '00'.repeat(64), 'hex'));
      const correct = value && validPassword(input?.password) && matchesHash && input?.username === value.username;
      if (!correct) fail(401, LOGIN_ERROR);
      return grant(req, res, value.username);
    });
  }
  function account(req, res) {
    const value = requireSession(req, res);
    return { username: value.username, csrf: value.csrf };
  }
  function updateAccount(req, res, input) {
    return serialize(async () => {
      const session = requireSession(req, res); requireCsrf(req, session);
      if (!validUsername(input?.username)) fail(400, '用户名需为 3–32 位，以英文字母或数字开头，仅允许字母、数字、点、下划线和连字符。');
      const changePassword = input?.newPassword !== undefined && input.newPassword !== '';
      if (changePassword && !validPassword(input.newPassword)) fail(400, '新密码需为 12–128 个字符，允许空格和中文。');
      consumeAttempt(req);
      const previous = await config();
      const derived = await hash(validPassword(input?.currentPassword) ? input.currentPassword : '', previous?.salt || '00'.repeat(32));
      const matchesHash = timingSafeEqual(derived, Buffer.from(previous?.hash || '00'.repeat(64), 'hex'));
      if (!previous || !validPassword(input?.currentPassword) || !matchesHash) fail(403, '当前密码不正确，请重新输入。');
      const value = { ...previous, version: 2, username: input.username, updatedAt: new Date(now()).toISOString() };
      if (changePassword) {
        value.salt = random();
        value.hash = (await hash(input.newPassword, value.salt)).toString('hex');
      }
      await saveCredentials(value);
      // The same queue guards login and protected mutations, so no in-flight old login can restore access.
      sessions.clear();
      return grant(req, res, value.username);
    });
  }
  function withSession(req, res, action) {
    return serialize(() => {
      const value = requireSession(req, res);
      requireCsrf(req, value);
      return action(value);
    });
  }
  function logout(req, res) {
    return withSession(req, res, value => {
      sessions.delete(value.key); cookie(req, res, SESSION_COOKIE, '', 0);
      return { authenticated: false };
    });
  }
  return { status, setup, login, logout, session, requireSession, requireCsrf, account, updateAccount, withSession };
}
