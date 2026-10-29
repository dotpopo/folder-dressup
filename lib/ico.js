'use strict';

// 零依赖 ICO 打包：256px 用 PNG 条目（官方推荐），小尺寸解码为 BMP 位图条目
// （兼容性最好）；解码失败的单张自动回退为 PNG 条目。

const zlib = require('node:zlib');

const ORDER = [256, 128, 64, 48, 32, 24, 16];

function parsePngSize(buf) {
  if (buf.length < 24) throw new Error('PNG 数据过短');
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('不是有效的 PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// 解码 8 位、非隔行的 PNG（canvas 导出即此形态）为 RGBA
function decodePngRgba(buf) {
  const { width, height } = parsePngSize(buf);
  let off = 8;
  let depth = 0;
  let color = 0;
  let interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      depth = data[8];
      color = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || color === 3) {
    throw new Error(`不支持的 PNG 形态（depth=${depth} color=${color} interlace=${interlace}）`);
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error(`不支持的 PNG 颜色类型 ${color}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < stride * height) throw new Error('PNG 像素数据不足');

  // 反滤波
  const recon = Buffer.alloc(stride * height);
  const bpp = channels;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = recon.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? recon.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 0xff;
    }
  }

  // 展开 RGBA
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const d = i * 4;
    if (color === 6) {
      rgba[d] = recon[s];
      rgba[d + 1] = recon[s + 1];
      rgba[d + 2] = recon[s + 2];
      rgba[d + 3] = recon[s + 3];
    } else if (color === 2) {
      rgba[d] = recon[s];
      rgba[d + 1] = recon[s + 1];
      rgba[d + 2] = recon[s + 2];
      rgba[d + 3] = 255;
    } else if (color === 0) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = recon[s];
      rgba[d + 3] = 255;
    } else if (color === 4) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = recon[s];
      rgba[d + 3] = recon[s + 1];
    }
  }
  return { width, height, rgba };
}

// RGBA → 32bpp DIB（XOR 自下而上 + 全 0 AND 掩码）
function dibFromRgba(rgba, w, h) {
  const xorSize = w * h * 4;
  const andRow = Math.ceil(w / 32) * 4;
  const andSize = andRow * h;
  const dib = Buffer.alloc(40 + xorSize + andSize);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(w, 4);
  dib.writeInt32LE(h * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(xorSize + andSize, 20);
  for (let y = 0; y < h; y++) {
    const dstRow = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = dstRow * w * 4 + x * 4;
      dib[40 + d] = rgba[s + 2];
      dib[40 + d + 1] = rgba[s + 1];
      dib[40 + d + 2] = rgba[s];
      dib[40 + d + 3] = rgba[s + 3];
    }
  }
  return dib;
}

// sizes: { [size: number]: Uint8Array | Buffer }
function buildIco(sizes) {
  if (!sizes || typeof sizes !== 'object') throw new Error('缺少图标尺寸数据');
  const present = ORDER.filter((s) => sizes[s]);
  if (present.length === 0) throw new Error('至少需要一个尺寸的 PNG');
  if (!present.includes(256)) throw new Error('缺少 256px 主尺寸');

  const images = [];
  for (const s of present) {
    const buf = Buffer.from(sizes[s]);
    const dim = parsePngSize(buf);
    if (dim.width !== s || dim.height !== s) {
      throw new Error(`尺寸 ${s} 的 PNG 实际为 ${dim.width}x${dim.height}`);
    }
    let data;
    let bitCount = 32;
    if (s < 256) {
      try {
        const { rgba } = decodePngRgba(buf);
        data = dibFromRgba(rgba, s, s);
      } catch {
        data = buf; // 解不开的形态回退为 PNG 条目（Vista+ 均可渲染）
      }
    } else {
      data = buf;
    }
    images.push({ size: s, data, bitCount });
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(images.length * 16);
  let offset = 6 + images.length * 16;
  const blobs = [];
  images.forEach((img, i) => {
    const e = i * 16;
    entries[e] = img.size >= 256 ? 0 : img.size;
    entries[e + 1] = img.size >= 256 ? 0 : img.size;
    entries.writeUInt16LE(1, e + 4);
    entries.writeUInt16LE(img.bitCount, e + 6);
    entries.writeUInt32LE(img.data.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    blobs.push(img.data);
    offset += img.data.length;
  });

  return Buffer.concat([header, entries, ...blobs]);
}

module.exports = { buildIco, ORDER, parsePngSize, decodePngRgba };
