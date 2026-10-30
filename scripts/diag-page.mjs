// 诊断：检查页面里关键函数/变量是否就绪，以及 setFolder 的实际行为。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const exe = path.join('D:', 'work', 'me', 'gym', 'folder-dressup', 'src-tauri', 'target', 'release', 'folder-dressup.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(os.tmpdir(), 'fd-diag');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.join(root, '子1'), { recursive: true });

const port = 9388;
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
console.log('目标:', JSON.stringify((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map(t => ({type:t.type,title:t.title.slice(0,30),url:t.url.slice(0,60)}))));

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
const consoleErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
  }
  if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable', params: {} }));

const ev = (expr) => new Promise((res) => {
  const i = ++id;
  pend.set(i, (m) => res(m.result?.result?.value ?? ('EXC: ' + (m.result?.exceptionDetails?.exception?.description || '').slice(0, 120))));
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
});

for (let i = 0; i < 40; i++) { if ((await ev('typeof setFolder')) === 'function') break; await sleep(500); }
console.log('typeof setFolder :', await ev('typeof setFolder'));
console.log('typeof setBrowseRoot:', await ev('typeof setBrowseRoot'));
console.log('typeof batchApply :', await ev('typeof batchApply'));
console.log('typeof fb         :', await ev('typeof fb'));
console.log('setFolder 结果    :', await ev(`(()=>{ try { setFolder(${JSON.stringify(root)}); return 'ok'; } catch(e) { return 'ERR ' + e.message; } })()`));
console.log('state.folder      :', await ev('state.folder'));
console.log('fb.root           :', await ev('fb.root'));
console.log('页面错误          :', JSON.stringify(consoleErrors.slice(0, 5)));

ws.close();
try { process.kill(app.pid); } catch {}
