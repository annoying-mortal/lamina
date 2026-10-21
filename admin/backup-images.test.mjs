import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareBackupImages, validateBackupImage, isPublicAddress, fetchBackupImage } from './backup-images.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
async function fixture(action) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'backup-images-'));
  const dataDir = join(projectRoot, 'src/content'); const uploadsDir = join(projectRoot, 'public/uploads');
  await mkdir(join(dataDir, 'blog/nested'), { recursive: true }); await mkdir(uploadsDir, { recursive: true });
  const files = new Map([
    ['content/site.json', Buffer.from(JSON.stringify({ url: 'https://site.example', logo: '/logo.svg', orbitImage: '/uploads/a.png' }))],
    ['content/library.json', Buffer.from('[]')], ['content/friends.json', Buffer.from('[]')],
  ]);
  await writeFile(join(projectRoot, 'public/logo.svg'), svg); await writeFile(join(uploadsDir, 'a.png'), png);
  try { await action({ projectRoot, dataDir, uploadsDir, files, siteUrl: 'http://127.0.0.1:4321' }); }
  finally { await rm(projectRoot, { recursive: true, force: true }); }
}
test('portable image snapshot covers settings, covers, avatars and Markdown while preserving originals', () => fixture(async options => {
  options.files.set('content/library.json', Buffer.from(JSON.stringify([{cover:'https://images.example/cover?id=1'}])));
  options.files.set('content/friends.json', Buffer.from(JSON.stringify([{avatar:'/uploads/a.png'}])));
  options.files.set('content/blog/nested/a.md', Buffer.from('---\ntitle: test\ncustom: preserve\n---\n![one](/uploads/a.png)\n![two][photo]\n[photo]: <https://images.example/cover?id=1>\n<img src="/logo.svg">'));
  const before = new Map(options.files); let remoteCalls = 0;
  const result = await prepareBackupImages({...options, downloadImage:async () => { remoteCalls++; return png; }});
  assert.equal(remoteCalls, 1); assert.equal(result.imageCount, 2); assert.deepEqual(result.warnings, []);
  assert.deepEqual(options.files, before);
  const settings = JSON.parse(result.files.get('content/site.json'));
  assert.match(settings.logo, /^\/uploads\/backup-[a-f0-9]{64}\.svg$/);
  assert.match(settings.orbitImage, /^\/uploads\/backup-[a-f0-9]{64}\.png$/);
  assert.equal(JSON.parse(result.files.get('content/library.json'))[0].cover, settings.orbitImage);
  const body = result.files.get('content/blog/nested/a.md').toString();
  assert.match(body, /custom: preserve/); assert.ok(!body.includes('images.example')); assert.ok(body.includes(settings.logo));
  assert.equal(JSON.parse(result.files.get('content/media.json')).length, 2);
}));
test('same-origin absolute image paths and relative Markdown images are captured locally', () => fixture(async options => {
  await writeFile(join(options.dataDir,'blog/nested/figure.png'),png);
  options.files.set('content/blog/nested/a.md',Buffer.from('![local](./figure.png)\n![site](https://site.example/uploads/a.png?v=3)'));
  const result = await prepareBackupImages({...options,downloadImage:async()=>{throw new Error('Network should not be used');}});
  assert.deepEqual(result.warnings,[]); assert.equal(result.imageCount,2);
  assert.equal((result.files.get('content/blog/nested/a.md').toString().match(/\/uploads\/backup-/g) || []).length,2);
}));
test('missing or inaccessible images retain their URLs with query-redacted warnings', () => fixture(async options => {
  options.files.set('content/library.json',Buffer.from(JSON.stringify([{cover:'https://images.example/private?token=secret'}])));
  options.files.set('content/friends.json',Buffer.from(JSON.stringify([{avatar:'/uploads/missing.png'}])));
  const result = await prepareBackupImages({...options,downloadImage:async()=>{throw new Error('Unavailable');}});
  assert.equal(result.warnings.length,2); assert.ok(result.warnings.every(w=>!w.includes('secret')));
  assert.equal(JSON.parse(result.files.get('content/library.json'))[0].cover,'https://images.example/private?token=secret');
}));
test('image collection will not follow symlinks or escape public/content roots', () => fixture(async options => {
  await writeFile(join(options.projectRoot,'secret.png'),png);
  await symlink(join(options.projectRoot,'secret.png'),join(options.uploadsDir,'linked.png'));
  options.files.set('content/blog/a.md', Buffer.from('![a](/uploads/linked.png)\n![b](/../secret.png)\n![c](/%252e%252e/secret.png)'));
  const result = await prepareBackupImages(options);
  assert.equal(result.imageCount,2); assert.equal(result.warnings.length,3);
}));
test('passive SVG supported, active or external SVG and executable impostors rejected', () => {
  assert.equal(validateBackupImage(svg).ext,'svg');
  assert.equal(validateBackupImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')).ext,'svg');
  assert.equal(validateBackupImage(Buffer.from('<?xml version="1.0"?>\n<!-- Exported logo, <script> is just a comment. -->\n<svg xmlns="http://www.w3.org/2000/svg"><!-- drawing --><circle r="1"/></svg>')).ext,'svg');
  assert.throws(() => validateBackupImage(Buffer.from('<svg>&lt;!--<script>alert(1)</script>--&gt;</svg>')));
  for (const text of ['<svg><script>alert(1)</script></svg>','<svg onload="alert(1)"></svg>','<svg><image href="https://example.com/a.png"/></svg>','<svg><foreignObject/></svg>','<svg><set attributeName="href" to="javascript:x"/></svg>','<svg><style>g{fill:url(https://evil.example/a)}</style></svg>','<!DOCTYPE svg><svg/>','<svg><style>@impo&#114;t "https://attacker.example/a.css";</style></svg>','<svg><g style="fill:u&#114;l(https://attacker.example/a.svg#foo)"/></svg>','<html>not an image</html>']) assert.throws(()=>validateBackupImage(Buffer.from(text)));
});
test('public destination classifier blocks private, mapped, reserved and transition addresses', () => {
  for (const ip of ['127.0.0.1','0.0.0.0','10.1.2.3','172.31.0.1','169.254.169.254','192.168.1.1','100.100.100.200','198.19.1.1','203.0.113.1','224.0.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','2001::1','2002:7f00:1::']) assert.equal(isPublicAddress(ip),false,ip);
  for (const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(isPublicAddress(ip),true,ip);
});
test('remote fetch rejects unsafe protocols, credentials, ports and DNS before connecting', async () => {
  for (const url of ['file:///tmp/a.png','http://user:pass@example.com/a.png','http://example.com:9000/a.png','http://127.0.0.1/a.png','http://[::1]/a.png']) await assert.rejects(fetchBackupImage(url));
  await assert.rejects(fetchBackupImage('https://images.example/a.png',{resolveHost:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]}),/Private or reserved/);
});

test('HTML-escaped and Markdown-escaped URLs are downloaded decoded and rewritten using the original token', () => fixture(async options => {
  const raw = '<img src="https://images.example/a.png?a=1&amp;b=2">\n![paren](https://images.example/a\\(1\\).png)';
  options.files.set('content/blog/a.md', Buffer.from(raw));
  const downloaded = [];
  const result = await prepareBackupImages({...options,downloadImage:async url=>{downloaded.push(url);return png;}});
  assert.ok(downloaded.includes('https://images.example/a.png?a=1&b=2'));
  assert.ok(downloaded.includes('https://images.example/a(1).png'));
  const changed = result.files.get('content/blog/a.md').toString();
  assert.ok(!changed.includes('images.example')); assert.deepEqual(result.warnings,[]);
}));
test('malformed remote references do not abort a backup', () => fixture(async options => {
  options.files.set('content/blog/a.md',Buffer.from('![bad](http://[broken)\n![bad](https://%zz/a.png)'));
  const result = await prepareBackupImages({...options,downloadImage:async()=>{throw new Error('Must not fetch');}});
  assert.ok(result.warnings.length >= 2); assert.equal(result.files.get('content/blog/a.md').toString(), options.files.get('content/blog/a.md').toString());
}));

test('only actual image spans change; repeated URLs in prose, links, code and custom YAML remain byte-identical', () => fixture(async options => {
  const url = 'https://images.example/same.png';
  const header = `---\r\ntitle: Keep source\r\ncustom:\r\n  homepage: "${url}" # preserve this URL\r\n  example: '![example](${url})'\r\n  nested: [one, {two: three}]\r\n  cover: "${url}" # actual image field\r\n---\r\n`;
  const preserved = `Prose ${url}\r\n[ordinary link](${url})\r\n\`![inline example](${url})\`\r\n\`\`code with a \` and ![example](${url})\`\`\r\n\`\`\`markdown\r\n![fenced example](${url})\r\n<img src="${url}">\r\n\`\`\`\r\n~~~html\r\n<img src="${url}">\r\n~~~\r\n<!-- <img src="${url}"> -->\r\n`;
  const actual = `![real](${url})\r\n<img alt="Example ${url}" src="${url}" data-src="${url}">\r\n<source srcset="${url} 1x, ${url} 2x">\r\n`;
  const original = header + preserved + actual;
  options.files.set('content/blog/nested/source.md', Buffer.from(original));
  let downloads = 0;
  const result = await prepareBackupImages({ ...options, downloadImage: async () => { downloads++; return png; } });
  const replacement = JSON.parse(result.files.get('content/site.json')).orbitImage;
  const expected = header.replace(`cover: "${url}"`, `cover: "${replacement}"`) + preserved
    + `![real](${replacement})\r\n<img alt="Example ${url}" src="${replacement}" data-src="${url}">\r\n<source srcset="${replacement} 1x, ${replacement} 2x">\r\n`;
  assert.equal(result.files.get('content/blog/nested/source.md').toString(), expected);
  assert.equal(options.files.get('content/blog/nested/source.md').toString(), original);
  assert.equal(downloads, 1); assert.deepEqual(result.warnings, []);
}));

test('shared Markdown image definitions keep normal links and their titles unchanged', () => fixture(async options => {
  const url = 'https://images.example/shared.png';
  options.files.set('content/blog/a.md', Buffer.from(`![shared image][shared]\n[normal link][shared]\n[shared]: <${url}> "Shared title"\n![image only][only]\n[only]: <${url}> "Image title"\n`));
  const result = await prepareBackupImages({ ...options, downloadImage: async () => png });
  const replacement = JSON.parse(result.files.get('content/site.json')).orbitImage;
  assert.equal(result.files.get('content/blog/a.md').toString(), `![shared image](<${replacement}> "Shared title")\n[normal link][shared]\n[shared]: <${url}> "Shared title"\n![image only][only]\n[only]: <${replacement}> "Image title"\n`);
}));

test('JSON rewrites known image values and rich text image spans without changing sibling URLs', () => fixture(async options => {
  const url = 'https://images.example/shared.png';
  const custom = { homepage: url, example: `[link](${url})`, nested: ['same', url] };
  options.files.set('content/library.json', Buffer.from(JSON.stringify([{ cover: url, url, custom, detail: `![image](${url})\n\`![code](${url})\`\nPlain ${url}` }])));
  const result = await prepareBackupImages({ ...options, downloadImage: async () => png });
  const replacement = JSON.parse(result.files.get('content/site.json')).orbitImage;
  const item = JSON.parse(result.files.get('content/library.json'))[0];
  assert.equal(item.cover, replacement); assert.equal(item.url, url); assert.deepEqual(item.custom, custom);
  assert.equal(item.detail, `![image](${replacement})\n\`![code](${url})\`\nPlain ${url}`);
}));

test('image warnings remain bounded for extremely long malformed and remote URLs', () => fixture(async options => {
  const url = `https://images.example/${'x'.repeat(12000)}.png`;
  options.files.set('content/blog/a.md', Buffer.from(`![bad](${url})\n![invalid](http://[${'x'.repeat(12000)})`));
  const result = await prepareBackupImages({ ...options, downloadImage: async () => { throw new Error('unavailable'); } });
  assert.equal(result.warnings.length, 2); assert.ok(result.warnings.every(warning => warning.length < 3000));
}));
