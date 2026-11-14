import { preview } from 'astro';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { uploadedFileHeaders } from '../lib/uploaded-files.mjs';

const { values } = parseArgs({ options: { host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '4321' } } });
const server = await preview({ server: { host: values.host, port: Number(values.port) } });
// Astro's static preview excludes user Vite plugins, so apply the shared headers
// before its request listener without replacing Astro's routing or file serving.
server.server.prependListener('request', uploadedFileHeaders(resolve(process.env.BUILD_OUTPUT_DIR || 'dist')));
