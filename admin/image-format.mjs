import { Buffer } from 'node:buffer';

/** Identify the raster formats shared by uploads and portable backups. */
export function detectRasterImage(data) {
  if (data.length >= 45 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && data.toString('ascii', 12, 16) === 'IHDR' && data.toString('ascii', data.length - 8, data.length - 4) === 'IEND' && data.readUInt32BE(16) && data.readUInt32BE(20)) return { ext: 'png', mime: 'image/png' };
  if (data.length >= 12 && data[0] === 255 && data[1] === 216 && data[2] === 255 && data.at(-2) === 255 && data.at(-1) === 217) return { ext: 'jpg', mime: 'image/jpeg' };
  if (data.length >= 14 && /^GIF8[79]a$/.test(data.toString('ascii', 0, 6)) && data.at(-1) === 59) return { ext: 'gif', mime: 'image/gif' };
  if (data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(data.toString('ascii', 12, 16)) && data.readUInt32LE(4) + 8 === data.length) return { ext: 'webp', mime: 'image/webp' };
  return null;
}
