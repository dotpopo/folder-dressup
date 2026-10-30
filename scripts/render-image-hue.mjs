// 渲染图片皮肤在两种色相下的效果，用于人工比对。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { renderSizes } = require('../lib/render-icon.js');

const candidates = [
  path.join(process.env.APPDATA, 'FolderDressup', 'packs', '阿蟹'),
  path.join(process.env.APPDATA, '文件夹换装', 'packs', '阿蟹'),
];
const dir = candidates.find((d) => fs.existsSync(d));
if (!dir) { console.log('找不到皮肤包'); process.exit(1); }

const file = fs.readdirSync(dir).find((f) => /\.(png|webp)$/i.test(f));
const b64 = fs.readFileSync(path.join(dir, file)).toString('base64');
const mime = file.endsWith('.webp') ? 'image/webp' : 'image/png';

for (const hue of [200, 20]) {
  const sizes = await renderSizes({ hue, text: '', image: `data:${mime};base64,${b64}` });
  const out = path.join('.test-target', 'shots', `img-hue${hue}.png`);
  fs.writeFileSync(out, sizes[256]);
  console.log('rendered', out);
}
