// 单一项目录下测试，图标位置唯一，便于肉眼与像素比对。
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { renderSizes } = require('../lib/render-icon.js');
const { applyIconToFolder, restoreFolderIcon } = require('../lib/apply.js');

const liveRoot = path.join(__dirname, '..', '.test-live');
const folder = path.join(liveRoot, '唯一项目');
fs.mkdirSync(folder, { recursive: true });
const shots = path.join(__dirname, '..', '.test-target', 'shots');
fs.mkdirSync(shots, { recursive: true });
await restoreFolderIcon(folder).catch(() => {});

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const snap = (tag) => {
  const out = path.join(shots, `live2-${tag}.png`);
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      'C:/Users/nuaib/AppData/Local/Temp/shot-explorer.ps1', b64('test-live'), out], { encoding: 'utf8' });
    return fs.readFileSync(out);
  } catch (e) { console.log('snap fail', tag); return null; }
};

spawn('explorer.exe', [liveRoot], { detached: true, stdio: 'ignore' }).unref();
await new Promise((r) => setTimeout(r, 3500));
const before = snap('0-before');

const t0 = Date.now();
await applyIconToFolder(folder, await renderSizes({ hue: 340, text: '', image: null }));
console.log('apply:', Date.now() - t0, 'ms');

for (const ms of [400, 1000, 2000, 4000]) {
  const wait = ms - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const img = snap(`at-${ms}`);
  console.log(`${ms}ms 与基线不同:`, img && before ? !img.equals(before) : 'n/a');
}
