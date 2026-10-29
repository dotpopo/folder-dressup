'use strict';

// 把多尺寸 PNG 打包成 Windows .ico。
// png-to-ico 惰性加载：渲染器与打图脚本不会牵连它，主进程使用。

const ORDER = [256, 128, 64, 48, 32, 24, 16];

function parsePngSize(buf) {
  if (buf.length < 24) throw new Error('PNG 数据过短');
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('不是有效的 PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// sizes: { [size: number]: Uint8Array | Buffer }
async function buildIco(sizes) {
  if (!sizes || typeof sizes !== 'object') throw new Error('缺少图标尺寸数据');
  const present = ORDER.filter((s) => sizes[s]);
  if (present.length === 0) throw new Error('至少需要一个尺寸的 PNG');
  if (!present.includes(256)) throw new Error('缺少 256px 主尺寸');

  const pngToIco = require('png-to-ico');
  const buffers = present.map((s) => {
    const buf = Buffer.from(sizes[s]);
    const dim = parsePngSize(buf);
    if (dim.width !== s || dim.height !== s) {
      throw new Error(`尺寸 ${s} 的 PNG 实际为 ${dim.width}x${dim.height}`);
    }
    return buf;
  });
  const ico = await pngToIco(buffers);
  if (!Buffer.isBuffer(ico) || ico.length < 8) throw new Error('ico 生成失败');
  return ico;
}

module.exports = { buildIco, ORDER, parsePngSize };
