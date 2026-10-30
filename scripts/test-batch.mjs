// 实测一键换装：5 个子目录 + 随机皮肤，检查磁盘结果。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const exe = path.join('D:', 'work', 'me', 'gym', 'folder-dressup', 'src-tauri', 'target', 'release', 'folder-dressup.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const root = path.join(os.tmpdir(), 'fd-batch');
fs.rmSync(root, { recursive: true, force: true });
for (let i = 1; i <= 5; i++) fs.mkdirSync(path.join(root, `子目录-${i}`), { recursive: true });

const port = 9391;
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
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
const ev = (expr) => new Promise((res) => {
  const i = ++id;
  pend.set(i, (m) => res(m.result?.result?.value ?? ('EXC: ' + (m.result?.exceptionDetails?.exception?.description || '').slice(0, 120))));
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
});

for (let i = 0; i < 40; i++) {
  if ((await ev('typeof batchApply')) === 'function') break;
  await sleep(500);
}

await ev('window.confirm = () => true');
console.log('setFolder:', await ev(`(()=>{ try { setFolder(${JSON.stringify(root)}); return 'ok'; } catch(e){ return 'ERR '+e.message; } })()`));
await sleep(1200);
await ev('state.spec.hue = 320');
const packs = await ev('window.api.packsList()');
await ev(`state.activeCat = 'pack:' + ${JSON.stringify(packs[0].dir)}`);
console.log('皮肤包:', packs[0].name, '| fb.root:', await ev('fb.root'));

const t0 = Date.now();
console.log('batchApply:', await ev('(async()=>{ try { await batchApply(); return "done"; } catch(e){ return "ERR "+e.message; } })()'));
console.log('耗时:', Date.now() - t0, 'ms');

// 图标一致性：列表返回的 data URL 应等于 desktop.ini 指向的 ico
const listed = await ev();
console.log('列表图标长度:', JSON.stringify(listed));

for (let i = 1; i <= 5; i++) {
  const d = path.join(root, `子目录-${i}`);
  const files = fs.readdirSync(d);
  const ico = files.find((f) => f.endsWith('.ico'));
  console.log(`  子目录-${i}: ico=${ico ? ico.slice(0, 20) + '…' : '无'} ini=${files.includes('desktop.ini')}`);
}

ws.close();
try { process.kill(app.pid); } catch {}
