// 验证：图片皮肤也受色相控制 + 左侧 📁 打开资源管理器。
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const exe = path.join('D:', 'work', 'me', 'gym', 'folder-dressup', 'src-tauri', 'target', 'release', 'folder-dressup.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = spawn(exe, [], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9355' },
});
app.unref();
await sleep(6500);

let page = null;
for (let i = 0; i < 20 && !page; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:9355/json/list')).json();
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

// 选一张 NFT 皮肤
const packs = await ev('window.api.packsList()');
console.log('皮肤包:', JSON.stringify(packs));
const pack = packs[0];
const files = await ev(`window.api.packFiles(${JSON.stringify(pack.dir)})`);
const img = await ev(`window.api.packImage(${JSON.stringify(pack.dir)}, ${JSON.stringify(files[0])})`);
await ev(`state.spec = { hue: 200, text: '', image: ${JSON.stringify(img)} }; schedulePreview();`);
await sleep(1200);
console.log('图片模式已载入，色相 200');

const shot = await ev('document.getElementById("preview").toDataURL("image/png")');
fs.writeFileSync(path.join('D:', 'work', 'me', 'gym', 'folder-dressup', '.test-target', 'shots', 'img-hue200.png'), Buffer.from(shot.split(',')[1], 'base64'));

await ev('state.spec.hue = 20; schedulePreview();');
await sleep(1200);
const shot2 = await ev('document.getElementById("preview").toDataURL("image/png")');
fs.writeFileSync(path.join('D:', 'work', 'me', 'gym', 'folder-dressup', '.test-target', 'shots', 'img-hue20.png'), Buffer.from(shot2.split(',')[1], 'base64'));
console.log('已生成两张对比图');

ws.close();
try { process.kill(app.pid); } catch {}
