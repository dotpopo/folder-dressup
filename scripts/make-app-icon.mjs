'use strict';

// 生成应用自身图标 assets/app.ico（与渲染器共用同一绘制模块）。

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { createCanvas } = require('@napi-rs/canvas');
const { drawFolderIcon } = require('../renderer/draw-folder.js');
const { buildIco } = require('../lib/ico.js');
const { renderSizes, SIZES } = require('../lib/render-icon.js');

const HUE = 258;

async function main() {
  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });

  const sizes = await renderSizes({ hue: HUE, text: '', image: null }, SIZES);

  const master = createCanvas(1024, 1024);
  await drawFolderIcon(master.getContext('2d'), 1024, { hue: HUE, text: '', image: null });
  fs.writeFileSync(path.join(outDir, 'app.png'), master.toBuffer('image/png'));

  const ico = await buildIco(sizes);
  const outPath = path.join(outDir, 'app.ico');
  fs.writeFileSync(outPath, ico);
  console.log(`已生成 ${outPath}（${ico.length} bytes，${SIZES.length} 个尺寸）与 app.png`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
