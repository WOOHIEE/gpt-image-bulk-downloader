import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const outDir = new URL("../assets/", import.meta.url);
const CRC_TABLE = createCrcTable();

await mkdir(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = createIconPng(size);
  await writeFile(new URL(`icon-${size}.png`, outDir), png);
}

function createIconPng(size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4;
      const t = (x + y) / (size * 2);
      const inside = roundedRect(x, y, size, size * 0.18);
      raw[offset] = inside ? Math.round(20 + 18 * t) : 0;
      raw[offset + 1] = inside ? Math.round(42 + 80 * t) : 0;
      raw[offset + 2] = inside ? Math.round(92 + 140 * t) : 0;
      raw[offset + 3] = inside ? 255 : 0;
      drawGlyph(raw, size, x, y, offset);
    }
  }

  return Buffer.concat([
    pngSignature(),
    chunk("IHDR", ihdr(size, size)),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function drawGlyph(raw, size, x, y, offset) {
  const margin = Math.max(2, Math.round(size * 0.23));
  const stroke = Math.max(1, Math.round(size * 0.08));
  const line1 = y >= margin && y < margin + stroke && x >= margin && x <= size - margin;
  const line2 = y >= Math.round(size * 0.45) && y < Math.round(size * 0.45) + stroke
    && x >= margin && x <= size - margin;
  const arrowStem = x >= Math.round(size * 0.5) - stroke && x <= Math.round(size * 0.5) + stroke
    && y >= Math.round(size * 0.48) && y <= size - margin;
  const arrowHead = y > size - margin - stroke * 3
    && Math.abs(x - Math.round(size * 0.5)) <= (y - (size - margin - stroke * 3)) + stroke;
  if (line1 || line2 || arrowStem || arrowHead) {
    raw[offset] = 255;
    raw[offset + 1] = 255;
    raw[offset + 2] = 255;
    raw[offset + 3] = 255;
  }
}

function roundedRect(x, y, width, radius) {
  const max = width - 1;
  const cx = x < radius ? radius : x > max - radius ? max - radius : x;
  const cy = y < radius ? radius : y > max - radius ? max - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function pngSignature() {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  return new Uint32Array(256).map((_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}
