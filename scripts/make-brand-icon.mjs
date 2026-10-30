'use strict';

// 品牌应用图标：圆角底板 + 白色文件夹 + 彩虹条（产品标志性元素）。
// 输出 assets/app.png(1024) 与 assets/app.ico（7 尺寸），供 Tauri/Electron 共用。

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { createCanvas } = require('@napi-rs/canvas');
const { buildIco } = require('../lib/ico.js');

const S = 1024;
const SIZES = [256, 128, 64, 48, 32, 24, 16];

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTile(ctx) {
  const inset = 46;
  const g = ctx.createLinearGradient(inset, inset, S - inset, S - inset);
  g.addColorStop(0, '#4C6BFF');
  g.addColorStop(0.55, '#6E5BF7');
  g.addColorStop(1, '#A24BF0');
  ctx.save();
  ctx.shadowColor = 'rgba(40, 30, 90, 0.35)';
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = g;
  rr(ctx, inset, inset, S - inset * 2, S - inset * 2, 226);
  ctx.fill();
  ctx.restore();

  // 顶部柔光
  ctx.save();
  rr(ctx, inset, inset, S - inset * 2, S - inset * 2, 226);
  ctx.clip();
  const gloss = ctx.createLinearGradient(0, inset, 0, S * 0.62);
  gloss.addColorStop(0, 'rgba(255,255,255,0.30)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();
}

function drawFolder(ctx) {
  // 后片 + 耳朵（大而清晰的轮廓，16px 也认得出是文件夹）
  ctx.save();
  ctx.shadowColor = 'rgba(24, 20, 60, 0.32)';
  ctx.shadowBlur = 46;
  ctx.shadowOffsetY = 22;
  ctx.fillStyle = '#E9EDFF';
  rr(ctx, 188, 236, 316, 132, 48);
  ctx.fill();
  rr(ctx, 188, 306, 648, 486, 78);
  ctx.fill();
  ctx.restore();

  // 前片
  ctx.save();
  ctx.shadowColor = 'rgba(24, 20, 60, 0.30)';
  ctx.shadowBlur = 38;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#ffffff';
  rr(ctx, 160, 452, 704, 356, 84);
  ctx.fill();
  ctx.restore();

  // 彩虹条：渐变按条自身宽度铺满整条光谱
  const bandX = 206;
  const bandW = 612;
  const bandY = 574;
  const bandH = 104;
  const rainbow = ctx.createLinearGradient(bandX, 0, bandX + bandW, 0);
  ['#FF5B4D', '#FF9D2E', '#FFD12E', '#8FD435', '#2ECF7F', '#2EC2C9', '#2E9BFF', '#4D6BFF', '#8F5BFF', '#D35BFF', '#FF5B9F'].forEach(
    (c, i, arr) => rainbow.addColorStop(i / (arr.length - 1), c)
  );
  ctx.save();
  ctx.fillStyle = rainbow;
  rr(ctx, bandX, bandY, bandW, bandH, 52);
  ctx.fill();
  ctx.restore();

  // 前片顶部高光
  ctx.save();
  rr(ctx, 160, 452, 704, 356, 84);
  ctx.clip();
  const gloss = ctx.createLinearGradient(0, 452, 0, 660);
  gloss.addColorStop(0, 'rgba(255,255,255,0.6)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(160, 452, 704, 208);
  ctx.restore();
}

function drawSparkle(ctx) {
  ctx.save();
  ctx.translate(806, 286);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  const r = 62;
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const rad = i % 2 === 0 ? r : r * 0.28;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function renderMaster() {
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  drawTile(ctx);
  drawFolder(ctx);
  drawSparkle(ctx);
  return canvas;
}

async function main() {
  const master = renderMaster();
  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'app.png'), master.toBuffer('image/png'));

  const sizes = {};
  let prev = master;
  let prevSize = S;
  for (const size of [...SIZES].sort((a, b) => b - a)) {
    let canvas;
    if (prevSize === size) {
      canvas = prev;
    } else {
      canvas = createCanvas(size, size);
      const c = canvas.getContext('2d');
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'best';
      c.drawImage(prev, 0, 0, prevSize, prevSize, 0, 0, size, size);
    }
    sizes[size] = canvas.toBuffer('image/png');
    prev = canvas;
    prevSize = size;
  }
  const ico = await buildIco(sizes);
  fs.writeFileSync(path.join(outDir, 'app.ico'), ico);

  // 预览：16/32/48 放大 8 倍，便于人眼检查小尺寸可辨识度
  const preview = createCanvas(8 * (16 + 32 + 48 + 24), 8 * 48 + 40);
  const pc = preview.getContext('2d');
  pc.fillStyle = '#e9ebef';
  pc.fillRect(0, 0, preview.width, preview.height);
  let x = 10;
  for (const size of [16, 24, 32, 48]) {
    const c = createCanvas(size, size);
    c.getContext('2d').drawImage(master, 0, 0, S, S, 0, 0, size, size);
    pc.drawImage(c, x, 10, size * 8, size * 8);
    x += size * 8 + 14;
  }
  fs.writeFileSync(path.join(outDir, 'icon-preview.png'), preview.toBuffer('image/png'));
  console.log('已生成 assets/app.png / app.ico / icon-preview.png');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
