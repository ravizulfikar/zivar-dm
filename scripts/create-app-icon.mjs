import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const size = 256;
const pixels = Buffer.alloc((size * 4 + 1) * size);
const distance = (x, y, ax, ay, bx, by) => {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
};
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const offset = y * (size * 4 + 1) + 1 + x * 4;
  const radius = 46, qx = Math.max(radius - x, x - (size - 1 - radius), 0), qy = Math.max(radius - y, y - (size - 1 - radius), 0);
  if (Math.hypot(qx, qy) > radius) continue;
  let color = [55, 65, 81, 255];
  if (distance(x, y, 128, 53, 128, 157) < 10 || distance(x, y, 86, 119, 128, 162) < 10 || distance(x, y, 128, 162, 170, 119) < 10 || distance(x, y, 78, 190, 178, 190) < 7) color = [255, 255, 255, 255];
  Buffer.from(color).copy(pixels, offset);
}
function crc32(data) { let crc = -1; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
function chunk(type, data) { const label = Buffer.from(type); const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length); label.copy(output, 4); data.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([label, data])), data.length + 8); return output; }
const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
const ico = Buffer.alloc(22); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../desktop/assets');
await fs.mkdir(target, { recursive: true }); await fs.writeFile(path.join(target, 'app.png'), png); await fs.writeFile(path.join(target, 'app.ico'), Buffer.concat([ico, png]));
console.log('Created Windows app icon.');
