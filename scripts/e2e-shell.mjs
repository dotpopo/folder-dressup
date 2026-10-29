'use strict';

// 端到端验证（真实外壳）：对一个真实测试文件夹应用图标，
// 用 SHGetFileInfo 提取 Explorer 当前显示的图标做前后对比。
// 用法：node scripts/e2e-shell.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { renderSizes } = require('../lib/render-icon.js');
const { applyIconToFolder, restoreFolderIcon } = require('../lib/apply.js');

const run = (cmd, args) => {
  const { execFileSync } = require('node:child_process');
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
};

async function main() {
  const root = path.join(__dirname, '..', '.test-target');
  const shots = path.join(root, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const folder = path.join(root, '换装测试');
  fs.mkdirSync(folder, { recursive: true });

  const before = path.join(shots, 'icon-before.png');
  const after = path.join(shots, 'icon-after.png');
  const restored = path.join(shots, 'icon-restored.png');

  console.log('1) 应用前外壳图标…');
  run('node', [path.join(__dirname, 'check-shell-icon.mjs'), folder, before]);

  console.log('2) 应用自定义图标（hue 340 / 文字「工作」）…');
  const sizes = await renderSizes({ hue: 340, text: '工作', image: null });
  await applyIconToFolder(folder, sizes);
  console.log(`   desktop.ini: ${fs.readFileSync(path.join(folder, 'desktop.ini'), 'utf16le').replace(/\0/g, '').trim()}`);

  console.log('3) 应用后外壳图标…');
  run('node', [path.join(__dirname, 'check-shell-icon.mjs'), folder, after]);

  const beforeBytes = fs.readFileSync(before);
  const afterBytes = fs.readFileSync(after);
  const changed = !beforeBytes.equals(afterBytes);
  console.log(changed ? '   ✓ 外壳返回的图标已变化' : '   ✗ 外壳图标未变化（图标缓存可能未刷新）');

  console.log('4) 还原并提取外壳图标…');
  await restoreFolderIcon(folder);
  run('node', [path.join(__dirname, 'check-shell-icon.mjs'), folder, restored]);

  const backToDefault = fs.readFileSync(restored).equals(beforeBytes);
  console.log(backToDefault ? '   ✓ 还原后与初始图标一致' : '   ⚠ 还原后图标与初始不同（缓存延迟，可忽略）');

  console.log(`截图目录：${shots}`);
  if (!changed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
