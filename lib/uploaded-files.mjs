import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Uploaded documents download as files; SVGs can render as images in a sandbox.
export function uploadedFileHeaders(root) {
  return (req, res, next = () => {}) => {
    const url = new URL(req.url, 'http://localhost');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { next(); return; }
    if (/^\/(?:static|uploads)\//.test(pathname)) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      if (!/\.(?:png|jpe?g|gif|webp|svg|ico|avif)$/i.test(pathname)) res.setHeader('Content-Disposition', 'attachment');
      if (pathname.startsWith('/uploads/') && !existsSync(join(root, pathname))) pathname = '/static/' + pathname.slice(9);
      req.url = pathname.split('/').map(encodeURIComponent).join('/') + url.search;
    }
    next();
  };
}
