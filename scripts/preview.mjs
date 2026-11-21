import { preview } from 'astro';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { uploadedFileHeaders } from '../lib/uploaded-files.mjs';
import { friendApplicationProxy } from './friend-application-proxy.mjs';

const { values } = parseArgs({ options: { host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '4321' } } });
const server = await preview({ server: { host: values.host, port: Number(values.port) } });
// Astro's static preview excludes user Vite plugins. Wrap its listeners so a
// handled submission never also reaches the static file server.
const listeners = server.server.listeners('request');
const proxy = friendApplicationProxy();
const uploadHeaders = uploadedFileHeaders(resolve(process.env.BUILD_OUTPUT_DIR || 'dist'));
server.server.removeAllListeners('request');
server.server.on('request', (req, res) => {
  proxy(req, res, () => uploadHeaders(req, res, () => {
    for (const listener of listeners) listener.call(server.server, req, res);
  }));
});
