// Tauri 版端到端验证：通过 WebView2 调试协议在页面内真实点击「应用」，检查磁盘结果。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const exe = 'D:\\work\\me\\gym\\folder-dressup\\src-tauri\\target\\release\\folder-dressup.exe';
const target = path.join(os.tmpdir(), 'fd-tauri-e2e');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

const child = spawn(exe, [], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222' },
});
child.unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
  }
  throw new Error('WebView2 调试端口未就绪');
}

const targetInfo = await findTarget();
const ws = new WebSocket(targetInfo.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};

function send(method, params) {
  const id = ++msgId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result && res.result.exceptionDetails) {
    throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 300));
  }
  return res.result && res.result.result ? res.result.result.value : undefined;
}

for (let i = 0; i < 40; i++) { if (await evaluate('typeof window.api === "object" && !!document.getElementById("apply")')) break; await sleep(400); }
console.log('页面标题:', await evaluate('document.title'));

const packs = await evaluate('window.api.packsList()');
console.log('皮肤包:', Array.isArray(packs) ? packs.map((p) => `${p.name}(${p.count})`).join(', ') : packs);

// 真实流程：填路径 → 回车 → 点应用
const folderJson = JSON.stringify(target);
await evaluate(`(() => {
  const input = document.getElementById('folder');
  input.value = ${folderJson};
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return true;
})()`);
await sleep(1200);
await evaluate(`(() => { document.getElementById('apply').click(); return true; })()`);
await sleep(2500);

const files = fs.readdirSync(target);
console.log('磁盘文件:', files.join(', ') || '(空)');
const ini = files.includes('desktop.ini')
  ? fs.readFileSync(path.join(target, 'desktop.ini'), 'utf16le').replace(/\0/g, '').trim().replace(/\r?\n/g, ' | ')
  : '(无)';
console.log('desktop.ini:', ini);

const state = await evaluate(`window.api.getState(${folderJson})`);
console.log('状态:', JSON.stringify(state));

ws.close();
try { process.kill(child.pid); } catch {}
