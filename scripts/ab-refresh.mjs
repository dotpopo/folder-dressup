// 直接证据：应用后截图，肉眼确认 item 模式是否真的刷新了视图。
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { renderSizes } = require('../lib/render-icon.js');

const exe = 'D:\\work\\me\\gym\\folder-dressup\\src-tauri\\target\\release\\folder-dressup.exe';
const mode = process.argv[2] || 'item';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const TMP = 'C:/Users/nuaib/AppData/Local/Temp';

const parent = path.join(__dirname, '..', '.tl-ab');
fs.rmSync(parent, { recursive: true, force: true });
fs.mkdirSync(parent, { recursive: true });
const target = path.join(parent, '目标');
fs.mkdirSync(target);
const needle = path.basename(parent);

const app = spawn(exe, [], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9361', FOLDERSHELL_NOTIFY: mode },
});
app.unref();
await sleep(6000);

let page = null;
for (let i = 0; i < 20 && !page; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:9361/json/list')).json();
    page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch {}
  if (!page) await sleep(500);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const invoke = (cmd, args) => new Promise((res) => {
  const i = ++id;
  pend.set(i, (m) => res(m.result));
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: {
    expression: `window.__TAURI__.core.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`,
    awaitPromise: true, returnByValue: true } }));
});

spawn('explorer.exe', [parent], { detached: true, stdio: 'ignore' }).unref();
await sleep(3500);

const snap = (tag) => {
  const out = path.join(__dirname, '..', '.test-target', 'shots', `ab-${mode}-${tag}.png`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    `${TMP}/shot-explorer.ps1`, b64(needle), out], { encoding: 'utf8' });
  return out;
};

console.log('A:', snap('1-before'));
for (const [i, hue] of [340, 200, 90].entries()) {
  const sizes = await renderSizes({ hue, text: '', image: null });
  const payload = {};
  for (const [s, buf] of Object.entries(sizes)) payload[s] = Buffer.from(buf).toString('base64');
  const t0 = Date.now();
  const res = await invoke('apply_icon', { folder: target, sizes: payload });
  const ms = Date.now() - t0;
  const payloadStr = JSON.stringify(res).slice(0, 200);
  await sleep(1500);
  const f = snap(`${i + 2}-hue${hue}`);
  console.log(`hue ${hue}: apply ${ms}ms → ${path.basename(f)} | ${payloadStr}`);
}

ws.close();
try { process.kill(app.pid); } catch {}
