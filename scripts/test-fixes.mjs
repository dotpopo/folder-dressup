// 验证三处修复：未选目标禁止应用 / 单次应用后列表刷新 / 一键换装可批量撤销。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const exe = path.join('D:', 'work', 'me', 'gym', 'folder-dressup', 'src-tauri', 'target', 'release', 'folder-dressup.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const root = path.join(os.tmpdir(), 'fd-fix3');
fs.rmSync(root, { recursive: true, force: true });
for (let i = 1; i <= 3; i++) fs.mkdirSync(path.join(root, `子-${i}`), { recursive: true });

const port = 9401;
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

await ev('window.confirm = () => true');
await ev(`setFolder(${JSON.stringify(root)})`);
await sleep(1500);

console.log('① 浏览父目录后：目标=', JSON.stringify(await ev('state.folder')), '| 应用按钮禁用=', await ev('els.apply.disabled'));

// 点第一个子文件夹
await ev("document.querySelectorAll('#fb-grid .fb-item')[0].click()");
await sleep(500);
console.log('② 点选子文件夹后：目标=', JSON.stringify(await ev('state.folder')), '| 应用按钮禁用=', await ev('els.apply.disabled'));

// 单次应用后列表是否刷新（比较列表图标长度变化）
const before = await ev("(async()=>{const p=await api.listSubdirs(fb.root,0,10,''); return p.items.map(i=>i.icon?i.icon.length:0).join(',');})()");
await ev('state.spec.hue = 300; applyToFolder()');
await sleep(2000);
const after = await ev("(async()=>{const p=await api.listSubdirs(fb.root,0,10,''); return p.items.map(i=>i.icon?i.icon.length:0).join(',');})()");
console.log('③ 单次应用后列表图标变化:', before !== after ? '已刷新' : '未变化', '(', before, '→', after, ')');

// 一键换装 + 撤销
await ev("state.activeCat = 'pack:' + packCats[0].dir");
await ev('batchApply()');
await sleep(3000);
const afterBatch = fs.readdirSync(path.join(root, '子-2')).filter((f) => f.endsWith('.ico')).length;
console.log('④ 一键换装后 子-2 的 ico 数:', afterBatch);

await ev('undoLastApply()');
await sleep(3000);
const afterUndo = fs.readdirSync(path.join(root, '子-2')).filter((f) => f.endsWith('.ico')).length;
const iniLeft = fs.existsSync(path.join(root, '子-2', 'desktop.ini'));
console.log('⑤ 撤销后 子-2 的 ico 数:', afterUndo, '| desktop.ini 存在:', iniLeft);

ws.close();
try { process.kill(app.pid); } catch {}
