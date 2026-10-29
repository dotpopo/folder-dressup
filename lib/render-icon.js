'use strict';

// Node 侧图标渲染：1024 主图逐级减半导出多尺寸 PNG（verify / 打应用图标 / E2E 共用）。

const { createCanvas } = require('@napi-rs/canvas');
const { drawFolderIcon } = require('./draw-folder');

const SIZES = [256, 128, 64, 48, 32, 24, 16];

async function renderSizes(spec, sizes = SIZES) {
  const master = createCanvas(1024, 1024);
  await drawFolderIcon(master.getContext('2d'), 1024, spec);

  const out = {};
  let prev = master;
  let prevSize = 1024;
  for (const size of [...sizes].sort((a, b) => b - a).concat([1024])) {
    let canvas;
    if (prevSize === size) {
      canvas = prev;
    } else {
      canvas = createCanvas(size, size);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'best';
      ctx.drawImage(prev, 0, 0, prevSize, prevSize, 0, 0, size, size);
    }
    if (sizes.includes(size)) out[size] = canvas.toBuffer('image/png');
    prev = canvas;
    prevSize = size;
  }
  return out;
}

module.exports = { renderSizes, SIZES };
