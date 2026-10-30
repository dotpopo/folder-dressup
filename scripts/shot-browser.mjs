// 打开"文件夹"标签并截图，用于视觉验收。
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const exe = path.join('D:', 'work', 'me', 'gym', 'folder-dressup', 'src-tauri', 'target', 'release', 'folder-dressup.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.tmpdir(), 'fd-browse');

const app = spawn(exe, [], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9229' },
});
app.unref();
await sleep(6500);

let page = null;
for (let i = 0; i < 20 && !page; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
    page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch {}
  if (!page) await sleep(500);
}
if (!page) { console.log('CDP 未就绪'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const ev = (expr) => new Promise((res) => {
  const i = ++id;
  pend.set(i, (m) => res(m.result?.result?.value));
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
});

await ev('switchTab("folders")');
await ev(`openFolders(${JSON.stringify(root)})`);
await sleep(1600);
ws.close();

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  'C:/Users/nuaib/AppData/Local/Temp/shot3.ps1', b64('folder-dressup')], { encoding: 'utf8' });
console.log('screenshot ok');
