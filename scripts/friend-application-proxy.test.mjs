import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { friendApplicationProxy } from './friend-application-proxy.mjs';

async function listen(t, listener) {
  const server = createServer(listener);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { server, port: server.address().port, base: `http://127.0.0.1:${server.address().port}` };
}

test('public proxy submits only the exact POST endpoint without forwarding credentials or trusted-proxy headers', async t => {
  const received = [];
  const backend = await listen(t, async (req, res) => {
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(buffers).toString() });
    res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': 'private=value', Location: '/api/settings', 'WWW-Authenticate': 'private' });
    res.end('{"received":true}');
  });
  const proxy = friendApplicationProxy({ port: backend.port });
  const front = await listen(t, (req, res) => proxy(req, res, () => { res.writeHead(404); res.end('Not found'); }));
  const payload = JSON.stringify({ name: 'Example', email: 'private@example.com' });
  const response = await fetch(front.base + '/api/friend-applications', {
    method: 'POST', body: payload, headers: {
      Origin: front.base, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin',
      Cookie: 'admin=secret', Authorization: 'Bearer secret', 'X-CSRF-Token': 'secret',
      'X-Forwarded-For': '1.2.3.4', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https',
    },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const header of ['set-cookie', 'location', 'www-authenticate']) assert.equal(response.headers.get(header), null);
  assert.equal(received.length, 1);
  const forwarded = received[0];
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.url, '/api/friend-applications');
  assert.equal(forwarded.body, payload);
  assert.equal(forwarded.headers.host, new URL(front.base).host);
  assert.equal(forwarded.headers.origin, front.base);
  assert.equal(forwarded.headers['sec-fetch-site'], 'same-origin');
  for (const name of ['cookie', 'authorization', 'x-csrf-token', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) assert.equal(forwarded.headers[name], undefined);
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
    const denied = await fetch(front.base + '/api/friend-applications', { method });
    assert.equal(denied.status, 405, method);
    assert.equal(denied.headers.get('allow'), 'POST');
    await denied.text();
  }
  for (const path of ['/api/friend-applications/', '/api/friend-applications?all=1', '/api/%66riend-applications', '/api/friend-applications/approve', '/api/settings', '/api/auth/status', '/api/friends']) {
    for (const method of ['GET', 'POST']) {
      const denied = await fetch(front.base + path, { method });
      assert.equal(denied.status, 404, `${method} ${path}`);
      await denied.text();
    }
  }
  const tooLarge = await fetch(front.base + '/api/friend-applications', { method: 'POST', body: 'x'.repeat(8 * 1024 + 1) });
  assert.equal(tooLarge.status, 413);
  await tooLarge.text();
  assert.equal(received.length, 1, 'forbidden requests never reach the backend');
});

test('public proxy preserves backend rejection and reports bounded upstream failure', async t => {
  let hanging = false;
  const backend = await listen(t, (req, res) => {
    req.resume();
    if (hanging) return;
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end('{"error":"later"}');
  });
  const proxy = friendApplicationProxy({ port: backend.port, timeoutMs: 100 });
  const front = await listen(t, (req, res) => proxy(req, res, () => res.end()));
  const response = await fetch(front.base + '/api/friend-applications', { method: 'POST', body: '{}' });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.deepEqual(await response.json(), { error: 'later' });
  hanging = true;
  const timedOut = await fetch(front.base + '/api/friend-applications', { method: 'POST', body: '{}' });
  assert.equal(timedOut.status, 504);
  await timedOut.text();
  await new Promise(resolve => backend.server.close(resolve));
  const unavailable = await fetch(front.base + '/api/friend-applications', { method: 'POST', body: '{}' });
  assert.equal(unavailable.status, 502);
  assert.match((await unavailable.json()).error, /暂不可用/);
});
