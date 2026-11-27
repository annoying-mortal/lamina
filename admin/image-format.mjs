import { Buffer } from 'node:buffer';

/** Identify raster formats from header/tail slices and total byte size without full-file buffering. */
export function detectRasterImageBounds(head, tail, size) {
  if (size >= 45 && head.length >= 24 && tail.length >= 8 && head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && head.toString('ascii', 12, 16) === 'IHDR' && tail.toString('ascii', tail.length - 8, tail.length - 4) === 'IEND' && head.readUInt32BE(16) && head.readUInt32BE(20)) return { ext: 'png', mime: 'image/png' };
  if (size >= 12 && head.length >= 3 && tail.length >= 2 && head[0] === 255 && head[1] === 216 && head[2] === 255 && tail.at(-2) === 255 && tail.at(-1) === 217) return { ext: 'jpg', mime: 'image/jpeg' };
  if (size >= 14 && head.length >= 6 && tail.length >= 1 && /^GIF8[79]a$/.test(head.toString('ascii', 0, 6)) && tail.at(-1) === 59) return { ext: 'gif', mime: 'image/gif' };
  if (size >= 30 && head.length >= 16 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(head.toString('ascii', 12, 16)) && head.readUInt32LE(4) + 8 === size) return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** Identify the raster formats shared by uploads and portable backups. */
export function detectRasterImage(data) {
  return detectRasterImageBounds(data.subarray(0, 32), data.subarray(Math.max(0, data.length - 12)), data.length);
}
