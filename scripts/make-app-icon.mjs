'use strict';

// 生成应用自身图标 assets/app.ico（与渲染器共用同一绘制模块）。

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { drawFolderIcon } = require('../lib/draw-folder.js');
const { buildIco } = require('../lib/ico.js');
const { renderSizes, SIZES } = require('../lib/render-icon.js');

const HUE = 258;

async function main() {
  const sizes = await renderSizes({ hue: HUE, text: '', image: null }, SIZES);

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
