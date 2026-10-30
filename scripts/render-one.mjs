// 渲染指定目录里第一张图作为皮肤，用于人工比对抠图质量。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { renderSizes } = require('../lib/render-icon.js');

const dir = process.argv[2];
const hue = Number(process.argv[3] || 200);
const out = process.argv[4] || '.test-target/shots/preview.png';
if (!dir) { console.log('用法: node render-one.mjs <目录> [hue] [输出]'); process.exit(1); }

const file = fs.readdirSync(dir).find((f) => /\.(png|webp|jpe?g)$/i.test(f));
const b64 = fs.readFileSync(path.join(dir, file)).toString('base64');
const mime = file.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/png';
const sizes = await renderSizes({ hue, text: '', image: `data:${mime};base64,${b64}` });
fs.writeFileSync(out, sizes[256]);
console.log('rendered', file, '→', out);
