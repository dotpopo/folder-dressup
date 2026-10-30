// 实测应用内文件夹浏览：列表、分页、双击进入、返回上级。
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const exe = path.join('D:', 'work', 'me', 'gym', 'folder-dressup', 'src-tauri', 'target', 'release', 'folder-dressup.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 造一个有很多子目录的父目录，验证分页
const root = path.join(os.tmpdir(), 'fd-browse');
const fs = await import('node:fs');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
for (let i = 1; i <= 60; i++) fs.mkdirSync(path.join(root, `项目-${String(i).padStart(2, '0')}`));
fs.mkdirSync(path.join(root, '项目-01', '子目录A'));

const app = spawn(exe, [], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9227' },
});
app.unref();
await sleep(6500);

let page = null;
for (let i = 0; i < 20 && !page; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:9227/json/list')).json();
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
  pend.set(i, (m) => res(m.result?.result?.value ?? m.result?.exceptionDetails?.exception?.description));
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
});

await ev('switchTab("folders")');
await ev(`openFolders(${JSON.stringify(root)})`);
await sleep(1500);

console.log('总数:', await ev("document.getElementById('fb-total').textContent"));
console.log('第1页卡片:', await ev("document.querySelectorAll('#fb-grid .fb-item').length"));
console.log('页码:', await ev("document.getElementById('fb-page').textContent"));
console.log('上一页禁用:', await ev("document.getElementById('fb-prev').disabled"));

await ev("document.getElementById('fb-next').click()");
await sleep(1200);
console.log('翻页后:', await ev("document.getElementById('fb-page').textContent"), '卡片', await ev("document.querySelectorAll('#fb-grid .fb-item').length"));

// 双击第一个进入
await ev("document.querySelectorAll('#fb-grid .fb-item')[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
await sleep(1200);
console.log('进入后路径:', await ev("document.getElementById('fb-path').textContent"));
console.log('进入后卡片:', await ev("document.querySelectorAll('#fb-grid .fb-item').length"));

await ev("document.getElementById('fb-up').click()");
await sleep(1200);
console.log('返回后路径:', await ev("document.getElementById('fb-path').textContent"));

// 搜索
await ev("const q=document.getElementById('fb-q'); q.value='项目-0'; q.dispatchEvent(new Event('input'));");
await sleep(1200);
console.log('搜索“项目-0”结果:', await ev("document.getElementById('fb-total').textContent"));

ws.close();
try { process.kill(app.pid); } catch {}
