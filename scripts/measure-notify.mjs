// 实测通知策略：每个策略用唯一父目录，确保 Explorer 打开的是全新窗口（不复用缓存视图）。
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { renderSizes } = require('../lib/render-icon.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const exe = 'D:\\work\\me\\gym\\folder-dressup\\src-tauri\\target\\release\\folder-dressup.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const TMP = 'C:/Users/nuaib/AppData/Local/Temp';

function shot(needle, out) {
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    `${TMP}/shot-explorer.ps1`, b64(needle), out], { encoding: 'utf8' });
  return out;
}

function rectOf(needle) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    `${TMP}/get-win-rect.ps1`, b64(needle)], { encoding: 'utf8' });
  const [l, t] = out.trim().split(',').map(Number);
  return { left: l || 0, top: t || 0 };
}

async function findIconCenter(pngPath) {
  const img = await loadImage(fs.readFileSync(pngPath));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  let sx = 0, sy = 0, n = 0;
  for (let y = 150; y < Math.min(img.height, 500); y += 2) {
    for (let x = 400; x < Math.min(img.width, 900); x += 2) {
      const i = (y * img.width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn > 50 && mx > 60) { sx += x; sy += y; n++; }
    }
  }
  return n > 20 ? { x: Math.round(sx / n), y: Math.round(sy / n), n } : null;
}

async function measure(mode, idx) {
  const parent = path.join(__dirname, '..', `.tl-${idx}`);
  fs.rmSync(parent, { recursive: true, force: true });
  fs.mkdirSync(parent, { recursive: true });
  const target = path.join(parent, '目标');
  fs.mkdirSync(target);
  const needle = path.basename(parent);

  const app = spawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9224', FOLDERSHELL_NOTIFY: mode },
  });
  app.unref();
  await sleep(6000);

  let page = null;
  for (let i = 0; i < 20 && !page; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9224/json/list')).json();
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
    if (!page) await sleep(500);
  }
  if (!page) { console.log(mode, 'CDP 未就绪'); return []; }

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

  execFileSync('powershell.exe', ['-NoProfile', '-Command', `$p = Get-Process explorer | Where-Object { $_.MainWindowTitle -like '*'+'%s'+'*' } | Select-Object -First 1; if ($p) { (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null }`.replace('%s', needle)], { encoding: 'utf8' });
  await sleep(800);
  const png = shot(needle, path.join(__dirname, '..', '.test-target', 'shots', `m-${mode}.png`));
  const rect = rectOf(needle);
  const center = await findIconCenter(png);
  if (!center) { console.log(mode, '未找到图标'); ws.close(); try { process.kill(app.pid); } catch {} return []; }
  const sx = center.x + rect.left;
  const sy = center.y + rect.top;
  console.log(`  [${mode}] 图标屏幕坐标 (${sx},${sy})`);

  const out = [];
  for (let k = 0; k < 4; k++) {
    const sizes = await renderSizes({ hue: (k * 83) % 360, text: '', image: null });
    const payload = {};
    for (const [s, buf] of Object.entries(sizes)) payload[s] = Buffer.from(buf).toString('base64');

    const probe = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      `${TMP}/probe-loop.ps1`, String(sx), String(sy), '40', '40', '9000'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    probe.stdout.on('data', (d) => { buf += d.toString(); });
    await sleep(600);
    const t0 = Date.now();
    await invoke('apply_icon', { folder: target, sizes: payload });
    const applyMs = Date.now() - t0;
    await new Promise((res) => { probe.on('exit', res); setTimeout(() => { try { probe.kill(); } catch {} res(); }, 9500); });
    const m = buf.match(/CHANGED (\d+)/);
    out.push({ applyMs, visible: m ? Number(m[1]) : null });
    console.log(`    第${k + 1}次 apply ${applyMs}ms → 可见 ${m ? m[1] + 'ms' : '未变'}`);
  }
  ws.close();
  try { process.kill(app.pid); } catch {}
  await sleep(1200);
  return out;
}

let idx = 0;
for (const mode of process.argv.slice(2)) {
  console.log('=== 策略:', mode, '===');
  const r = await measure(mode, ++idx);
  const vis = r.filter((x) => x.visible !== null).map((x) => x.visible);
  console.log(`  汇总 ${mode}: ${vis.length}/${r.length} 次刷新，延迟 ${vis.join(', ') || '—'} ms`);
}
