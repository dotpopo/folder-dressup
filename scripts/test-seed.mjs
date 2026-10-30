// 模拟全新安装：临时 APPDATA + 启动应用，检查内置皮肤包是否释放。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const exe = path.join('D:', 'work', 'me', 'gym', 'folder-dressup', 'src-tauri', 'target', 'release', 'folder-dressup.exe');
const tmpAppData = path.join(os.tmpdir(), 'fdappdata');
fs.rmSync(tmpAppData, { recursive: true, force: true });
fs.mkdirSync(tmpAppData, { recursive: true });

const app = spawn(exe, [], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, APPDATA: tmpAppData },
});
app.unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(7000);

const packsDir = path.join(tmpAppData, 'FolderDressup', 'packs');
const exists = fs.existsSync(packsDir);
const dirs = exists ? fs.readdirSync(packsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
console.log('数据目录:', packsDir);
console.log('存在:', exists, '| 皮肤包:', dirs.join(', ') || '(无)');
for (const d of dirs) {
  const files = fs.readdirSync(path.join(packsDir, d)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  console.log(`  ${d}: ${files.length} 张`);
}

try { process.kill(app.pid); } catch {}
