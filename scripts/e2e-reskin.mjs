// 验证换肤后 Explorer 真实显示的图标会跟着变（图标缓存回归的端到端证明）。
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { renderSizes } = require('../lib/render-icon.js');
const { applyIconToFolder } = require('../lib/apply.js');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..', '.test-target');
const folder = path.join(root, '换肤连续测试');
const shots = path.join(root, 'shots');
fs.mkdirSync(folder, { recursive: true });
fs.mkdirSync(shots, { recursive: true });

const check = (out) => execFileSync('node', [path.join(__dirname, 'check-shell-icon.mjs'), folder, out], { encoding: 'utf8' }).trim();

console.log('A) 应用 hue 160「验证」…');
await applyIconToFolder(folder, await renderSizes({ hue: 160, text: '验证', image: null }));
check(path.join(shots, 'e2e-a.png'));

console.log('B) 同一文件夹改应用 hue 340「测试」…');
await applyIconToFolder(folder, await renderSizes({ hue: 340, text: '测试', image: null }));
check(path.join(shots, 'e2e-b.png'));

const a = fs.readFileSync(path.join(shots, 'e2e-a.png'));
const b = fs.readFileSync(path.join(shots, 'e2e-b.png'));
console.log(a.equals(b) ? '✗ 外壳图标未变化（缓存未失效）' : '✓ 外壳图标已随换肤变化');

console.log('C) 应用 NFT 皮肤图片封面…');
const imgPath = path.join(os.tmpdir(), 'pack-cover.png');
fs.copyFileSync(path.join(__dirname, '..', 'film', 'assets', 'packs', 'axie-ronin-01.png'), imgPath);
const dataUrl = `data:image/png;base64,${fs.readFileSync(imgPath).toString('base64')}`;
await applyIconToFolder(folder, await renderSizes({ hue: 210, text: '', image: dataUrl }));
check(path.join(shots, 'e2e-c.png'));
const c = fs.readFileSync(path.join(shots, 'e2e-c.png'));
console.log(c.equals(b) ? '✗ NFT 皮肤图标未变化' : '✓ NFT 皮肤封面已上到文件夹图标');

await restoreOnce();
async function restoreOnce() {
  const { restoreFolderIcon } = require('../lib/apply.js');
  await restoreFolderIcon(folder);
  check(path.join(shots, 'e2e-restored.png'));
  console.log('D) 已还原默认');
}
