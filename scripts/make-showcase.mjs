// 生成三套皮肤包的展示图（README / 官网共用）：每套取 6 张，渲染成文件夹图标并排。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { createCanvas } = require('@napi-rs/canvas');
const { renderSizes } = require('../lib/render-icon.js');

const SEED = path.join(__dirname, '..', 'packs-seed');
const OUT_DOCS = path.join(__dirname, '..', 'docs');
const OUT_WEB = path.join(__dirname, '..', 'website', 'assets');
fs.mkdirSync(OUT_DOCS, { recursive: true });
fs.mkdirSync(OUT_WEB, { recursive: true });

const PACKS = [
  { dir: '阿蟹', file: 'axie', hue: 205, label: '阿蟹 · Axie' },
  { dir: '胖企鹅', file: 'pudgys', hue: 200, label: '胖企鹅 · Lil Pudgys' },
  { dir: 'Muse', file: 'muse', hue: 320, label: 'Muse' },
];

const COLS = 6;
const CELL = 300;
const PAD = 24;
const W = COLS * CELL + PAD * 2;
const H = CELL + PAD * 2 + 56;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

for (const pack of PACKS) {
  const dir = path.join(SEED, pack.dir);
  const files = fs.readdirSync(dir).filter((f) => /\.webp$/i.test(f)).sort();
  const step = Math.max(1, Math.floor(files.length / COLS));
  const picks = [];
  for (let i = 0; i < COLS; i++) {
    const f = files[Math.min(files.length - 1, i * step)];
    if (f) picks.push(f);
  }

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f5f7';
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < picks.length; i++) {
    const f = picks[i];
    const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
    const sizes = await renderSizes({ hue: pack.hue + i * 8, text: '', image: `data:image/webp;base64,${b64}` });
    const icon = await (async () => {
      const { loadImage } = require('@napi-rs/canvas');
      return loadImage(sizes[256]);
    })();

    const x = PAD + i * CELL;
    const y = PAD;
    // 卡片
    ctx.save();
    ctx.shadowColor = 'rgba(20, 24, 34, 0.08)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x + 8, y, CELL - 16, CELL - 20, 20);
    ctx.fill();
    ctx.restore();
    ctx.drawImage(icon, x + 8 + (CELL - 16 - 200) / 2, y + 24, 200, 200);
    // 文件名
    ctx.fillStyle = '#7a7f87';
    ctx.font = '500 15px "Segoe UI", "Microsoft YaHei UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.replace(/\.webp$/i, ''), x + CELL / 2, y + CELL - 26);
  }

  ctx.fillStyle = '#17181a';
  ctx.font = '700 22px "Segoe UI", "Microsoft YaHei UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(pack.label, PAD + 4, H - 26);

  const png = canvas.toBuffer('image/png');
  const name = `packs-${pack.file}.png`;
  fs.writeFileSync(path.join(OUT_DOCS, name), png);
  fs.writeFileSync(path.join(OUT_WEB, name), png);
  console.log('生成', name, `${W}x${H}`);
}
