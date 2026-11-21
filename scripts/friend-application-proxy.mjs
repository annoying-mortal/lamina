import { request } from 'node:http';

const endpoint = '/api/friend-applications';
const maxBodyBytes = 8 * 1024;

// Only the public submission route crosses from the static site into the CMS.
// The upstream is local configuration, never a request header or URL parameter.
export function friendApplicationProxy({ port = Number(process.env.ADMIN_PORT || 4322), timeoutMs = 15000 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ADMIN_PORT 必须是有效端口。');
  return (req, res, next) => {
    if (req.url !== endpoint) { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: message }));
    };
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      fail(405, '此地址仅支持 POST。');
      return;
    }
    let upstream;
    let finished = false;
    const finish = () => {
      finished = true;
      clearTimeout(timer);
      upstream?.destroy();
    };
    const reject = (status, message) => {
      if (finished) return;
      if (res.headersSent) res.destroy();
      else fail(status, message);
      finish();
    };
    const timer = setTimeout(() => reject(504, '申请服务响应超时，请稍后再试。'), timeoutMs);
    res.once('close', finish);
    req.once('aborted', finish);
    req.once('error', finish);
    const buffers = [];
    let length = 0;
    req.on('data', chunk => {
      if (finished) return;
      length += chunk.length;
      if (length > maxBodyBytes) { reject(413, '申请内容过大。'); return; }
      buffers.push(chunk);
    });
    req.once('end', () => {
      if (finished) return;
      const headers = { 'Content-Length': length };
      for (const name of ['host', 'origin', 'content-type', 'sec-fetch-site']) {
        if (req.headers[name] !== undefined) headers[name] = req.headers[name];
      }
      upstream = request({ hostname: '127.0.0.1', port, path: endpoint, method: 'POST', headers }, response => {
        if (finished) { response.destroy(); return; }
        // Never relay cookies, redirects, or CMS authentication headers.
        for (const name of ['content-type', 'retry-after']) {
          if (response.headers[name] !== undefined) res.setHeader(name, response.headers[name]);
        }
        res.writeHead(response.statusCode);
        response.on('error', () => res.destroy());
        response.pipe(res);
      });
      upstream.on('error', () => reject(502, '申请服务暂不可用，请稍后再试。'));
      upstream.end(Buffer.concat(buffers));
    });
  };
}
