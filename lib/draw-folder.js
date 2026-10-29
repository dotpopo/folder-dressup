'use strict';

// 纯 Canvas 2D 绘制模块：渲染器（浏览器 canvas）与打包脚本（@napi-rs/canvas）共用。
// 不依赖任何 DOM/Node API，只调用传入的 2D context。
// 双环境：Node require 得到 module.exports；浏览器 <script> 挂到 globalThis.FolderArt。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FolderArt = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

const VIRTUAL = 1000;

function normalizeSpec(raw) {
  const spec = { hue: 210, text: '', image: null };
  if (raw && typeof raw === 'object') {
    if (Number.isFinite(raw.hue)) spec.hue = ((raw.hue % 360) + 360) % 360;
    if (typeof raw.text === 'string') spec.text = raw.text.trim().slice(0, 12);
    if (typeof raw.image === 'string' && raw.image.startsWith('data:image/')) spec.image = raw.image;
  }
  return spec;
}

function hasEmoji(text) {
  return /\p{Extended_Pictographic}/u.test(text);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 文件夹背板（含左侧耳朵）
function backPath(ctx) {
  const r = 56;
  ctx.beginPath();
  ctx.moveTo(60, 200);
  ctx.arcTo(60, 150, 116, 150, 50);
  ctx.lineTo(392, 150);
  ctx.arcTo(448, 150, 448, 200, 50);
  ctx.lineTo(448, 236);
  ctx.lineTo(884, 236);
  ctx.arcTo(940, 236, 940, 292, r);
  ctx.lineTo(940, 828);
  ctx.arcTo(940, 884, 884, 884, r);
  ctx.lineTo(116, 884);
  ctx.arcTo(60, 884, 60, 828, r);
  ctx.closePath();
}

function frontPath(ctx) {
  roundRectPath(ctx, 60, 306, 880, 578, 62);
}

function paperPath(ctx, x, y, w, h, r) {
  roundRectPath(ctx, x, y, w, h, r);
}

function drawBase(ctx, hue) {
  const back = ctx.createLinearGradient(0, 150, 0, 884);
  back.addColorStop(0, `hsl(${hue}, 62%, 60%)`);
  back.addColorStop(1, `hsl(${hue}, 58%, 46%)`);
  ctx.fillStyle = back;
  backPath(ctx);
  ctx.fill();

  // 露出的白纸
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.10)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#f2f4f8';
  paperPath(ctx, 98, 196, 804, 190, 34);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  paperPath(ctx, 92, 228, 816, 150, 34);
  ctx.fill();
}

function drawFront(ctx, hue) {
  ctx.save();
  ctx.shadowColor = 'rgba(31, 41, 61, 0.22)';
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 16;
  const grad = ctx.createLinearGradient(0, 306, 0, 884);
  grad.addColorStop(0, `hsl(${hue}, 70%, 68%)`);
  grad.addColorStop(0.55, `hsl(${hue}, 66%, 58%)`);
  grad.addColorStop(1, `hsl(${hue}, 64%, 50%)`);
  ctx.fillStyle = grad;
  frontPath(ctx);
  ctx.fill();
  ctx.restore();

  // 顶部内高光
  ctx.save();
  frontPath(ctx);
  ctx.clip();
  const gloss = ctx.createLinearGradient(0, 306, 0, 620);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(60, 306, 880, 320);
  ctx.restore();
}

function fitFont(ctx, text, weight, family, maxWidth, startSize) {
  let size = startSize;
  // 下限 44：12 个 CJK 字符在 44px 时约 528px，仍能收进 680px 的目标宽度
  for (; size > 44; size -= 10) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return size;
}

function drawEngravedText(ctx, hue, text) {
  const family = `'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif`;
  const size = fitFont(ctx, text, '700', family, 680, 300);
  ctx.font = `700 ${size}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.save();
  ctx.translate(500, 622);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.20)';
  ctx.fillText(text, 0, 7);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
  ctx.fillText(text, 0, -6);
  ctx.fillStyle = `hsla(${hue}, 40%, 34%, 0.44)`;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawEmojiText(ctx, emoji) {
  const family = `'Segoe UI Emoji', 'Segoe UI Symbol', sans-serif`;
  const size = fitFont(ctx, emoji, '400', family, 640, 400);
  ctx.font = `${size}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.save();
  ctx.shadowColor = 'rgba(31, 41, 61, 0.25)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 10;
  ctx.fillText(emoji, 500, 630);
  ctx.restore();
}

async function drawImageFront(ctx, spec) {
  const img = new Image();
  img.decoding = 'sync';
  const loaded = new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = spec.image;
  });
  await loaded;

  ctx.save();
  ctx.shadowColor = 'rgba(31, 41, 61, 0.22)';
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 16;
  frontPath(ctx);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  ctx.save();
  frontPath(ctx);
  ctx.clip();
  const w = img.width || img.naturalWidth || 1;
  const h = img.height || img.naturalHeight || 1;
  const scale = Math.max(880 / w, 578 / h);
  const dw = w * scale;
  const dh = h * scale;
  ctx.drawImage(img, 500 - dw / 2, 595 - dh / 2, dw, dh);
  const gloss = ctx.createLinearGradient(0, 306, 0, 640);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(60, 306, 880, 340);
  ctx.restore();
}

// spec: { hue, text, image }；返回 Promise 以兼容图片模式（同步绘制时同样可用）
function drawFolderIcon(ctx, size, rawSpec) {
  const spec = normalizeSpec(rawSpec);
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  const scale = size / VIRTUAL;
  ctx.scale(scale, scale);

  drawBase(ctx, spec.hue);
  drawFront(ctx, spec.hue);

  let after;
  if (spec.image) {
    after = drawImageFront(ctx, spec);
  } else {
    if (hasEmoji(spec.text)) drawEmojiText(ctx, spec.text);
    else if (spec.text) drawEngravedText(ctx, spec.hue, spec.text);
    after = Promise.resolve();
  }

  ctx.restore();
  return after.then(() => undefined);
}

  return { drawFolderIcon, normalizeSpec, hasEmoji, VIRTUAL };
});
