'use strict';

// 生成应用自身图标 assets/app.ico（与渲染器共用同一绘制模块）。

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { createCanvas } = require('@napi-rs/canvas');
const { drawFolderIcon } = require('../lib/draw-folder.js');
const { buildIco } = require('../lib/ico.js');

const SIZES = [256, 128, 64, 48, 32, 24, 16];
const HUE = 258;

async function main() {
  const sizes = {};
  const master = createCanvas(1024, 1024);
  await drawFolderIcon(master.getContext('2d'), 1024, { hue: HUE, text: '', image: null });

  let prev = master;
  let prevSize = 1024;
  for (const size of [...SIZES].sort((a, b) => b - a).concat([1024])) {
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
    if (SIZES.includes(size)) sizes[size] = canvas.toBuffer('image/png');
    prev = canvas;
    prevSize = size;
  }

  const ico = await buildIco(sizes);
  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'app.ico');
  fs.writeFileSync(outPath, ico);
  console.log(`已生成 ${outPath}（${ico.length} bytes，${SIZES.length} 个尺寸）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
