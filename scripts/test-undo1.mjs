// 验证单次应用的撤销：应用后应能完全回退到换装前状态。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const exe = path.join('D:', 'work', 'me', 'gym', 'folder-dressup', 'src-tauri', 'target', 'release', 'folder-dressup.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const root = path.join(os.tmpdir(), 'fd-undo1');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.join(root, '子A'), { recursive: true });

const port = 9411;
const app = spawn(exe, [], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
});
app.unref();

let page = null;
for (let i = 0; i < 40 && !page; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch {}
}
if (!page) { console.log('CDP 未就绪'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const ev = (expr) => new Promise((res) => {
  const i = ++id;
  pend.set(i, (m) => res(m.result?.result?.value ?? ('EXC: ' + (m.result?.exceptionDetails?.exception?.description || '').slice(0, 100))));
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
});

for (let i = 0; i < 40; i++) {
  if ((await ev('typeof setFolder')) === 'function') break;
  await sleep(500);
}

await ev(`setFolder(${JSON.stringify(root)})`);
await sleep(1500);
await ev("document.querySelectorAll('#fb-grid .fb-item')[0].click()");
await sleep(400);

const target = path.join(root, '子A');
const snapshot = () => ({
  ico: fs.readdirSync(target).filter((f) => f.endsWith('.ico')).length,
  ini: fs.existsSync(path.join(target, 'desktop.ini')),
});

console.log('换装前:', JSON.stringify(snapshot()));
await ev('state.spec.hue = 150; applyToFolder()');
await sleep(2000);
console.log('换装后:', JSON.stringify(snapshot()));

await ev('undoLastApply()');
await sleep(2500);
console.log('撤销后:', JSON.stringify(snapshot()));

ws.close();
try { process.kill(app.pid); } catch {}
