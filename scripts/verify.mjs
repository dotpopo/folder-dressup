'use strict';

// 验证脚本 = 本项目的测试套件（AGENTS.md 规则 5）。每次交付前运行：npm run verify。
// 覆盖：绘制冒烟、ico 结构、desktop.ini 纯函数、真实文件夹的应用/还原幂等。

import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { createCanvas } = require('@napi-rs/canvas');
const { drawFolderIcon, normalizeSpec } = require('../lib/draw-folder.js');
const { buildIco, parsePngSize } = require('../lib/ico.js');
const {
  applyIconToFolder,
  restoreFolderIcon,
  readFolderCustomization,
  upsertIconResource,
  removeIconResource,
  encodeIni,
  decodeIni,
} = require('../lib/apply.js');

const execFileP = promisify(execFile);

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name + (detail ? `（${detail}）` : ''));
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function section(title, fn) {
  console.log(`\n■ ${title}`);
  try {
    await fn();
  } catch (err) {
    failures.push(`${title}：异常 ${err.message}`);
    console.log(`  ✗ 异常：${err.stack || err}`);
  }
}

async function renderSizes(spec, sizes) {
  const out = {};
  const master = createCanvas(1024, 1024);
  await drawFolderIcon(master.getContext('2d'), 1024, spec);
  let prev = master;
  let prevSize = 1024;
  for (const size of [...sizes].sort((a, b) => b - a).concat([1024])) {
    let canvas;
    if (prevSize === size) {
      canvas = prev;
    } else {
      canvas = createCanvas(size, size);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'best';
      ctx.drawImage(prev, 0, 0, prevSize, prevSize, 0, 0, size, size);
    }
    if (size !== 1024) out[size] = canvas.toBuffer('image/png');
    prev = canvas;
    prevSize = size;
  }
  return out;
}

function icoEntries(buf) {
  const count = buf.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    entries.push({
      width: buf[off] === 0 ? 256 : buf[off],
      height: buf[off + 1] === 0 ? 256 : buf[off + 1],
      planes: buf.readUInt16LE(off + 4),
      bitCount: buf.readUInt16LE(off + 6),
      size: buf.readUInt32LE(off + 8),
      offset: buf.readUInt32LE(off + 12),
    });
  }
  return entries;
}

async function attribFlags(target) {
  const { stdout } = await execFileP('attrib', [target]);
  const line = stdout.split(/\r?\n/).find((l) => l.includes(target));
  return new Set((line || '').slice(0, 14).match(/[A-Z]/g) || []);
}

/* ---------------- 测试 ---------------- */

await section('绘制冒烟', async () => {
  const canvas = createCanvas(512, 512);
  await drawFolderIcon(canvas.getContext('2d'), 512, { hue: 30, text: '工作' });
  const png = canvas.toBuffer('image/png');
  const dim = parsePngSize(png);
  check('512px PNG 有效', dim.width === 512 && dim.height === 512);
  check('非空白（体积 > 8KB）', png.length > 8 * 1024, `${png.length}B`);

  const emoji = createCanvas(256, 256);
  await drawFolderIcon(emoji.getContext('2d'), 256, { hue: 0, text: '🎮' });
  check('Emoji 绘制不抛错', emoji.toBuffer('image/png').length > 4 * 1024);

  const spec = normalizeSpec({ hue: 400, text: '  hi  ', image: 'javascript:alert(1)' });
  check('normalizeSpec 归一 hue/文本并拒绝非法 image',
    spec.hue === 40 && spec.text === 'hi' && spec.image === null,
    JSON.stringify(spec));
});

await section('ico 结构', async () => {
  const sizes = await renderSizes({ hue: 210, text: '' }, [256, 128, 64, 48, 32, 24, 16]);
  const ico = await buildIco(sizes);
  check('ICONDIR 头', ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1);
  check('条目数 7', icoEntries(ico).length === 7);
  const entries = icoEntries(ico);
  check('含 256 主尺寸', entries.some((e) => e.width === 256 && e.height === 256));
  check('尺寸齐全', [16, 24, 32, 48, 64, 128].every((s) => entries.some((e) => e.width === s)));
  const last = entries[entries.length - 1];
  check('最后条目 offset+size == 文件长', last.offset + last.size === ico.length);
  const ordered = [...entries].every((e) => e.size > 0);
  check('每条目有数据', ordered);

  let threw = false;
  try {
    await buildIco({ 128: sizes[128] });
  } catch {
    threw = true;
  }
  check('缺 256 主尺寸时报错', threw);
});

await section('desktop.ini 纯函数', async () => {
  const ico = 'C:\\目标\\文件夹\\.diricon.ico';
  const once = upsertIconResource('', ico);
  check('空内容生成区块', once.includes('[.ShellClassInfo]') && once.includes(`IconResource=${ico},0`));
  const twice = upsertIconResource(once, ico);
  check('幂等（upsert 两次一致）', twice === once);

  const replaced = upsertIconResource('[.ShellClassInfo]\r\nIconResource=D:\\旧\\x.ico,0', ico);
  check('替换已有 IconResource', (replaced.match(/IconResource=/g) || []).length === 1 && replaced.includes(ico));

  const preserved = upsertIconResource('[.ShellClassInfo]\r\nConfirmFileOp=0\r\n\r\n[ViewMode]\nMode=2', ico);
  check('保留其他键与其他区块', preserved.includes('ConfirmFileOp=0') && preserved.includes('Mode=2'));

  const r1 = removeIconResource(preserved);
  check('移除后其余内容保留', r1.removed && r1.content.includes('ConfirmFileOp=0'));
  const r2 = removeIconResource(once);
  check('区块清空后删除整个文件内容', r2.removed && r2.content.trim() === '');
  const r3 = removeIconResource('[Nothing]\r\nFoo=1');
  check('无 IconResource 时内容不动', !r3.removed && r3.content.includes('Foo=1'));

  const cn = 'C:\\中文\\路径\\.diricon.ico';
  const round = decodeIni(encodeIni(upsertIconResource('', cn)));
  check('UTF-16LE 编解码往返（中文路径）', round.includes(cn));
});

await section('真实文件夹应用 / 还原（含幂等）', async () => {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), 'folder-dressup-verify-'));
  const sizes = await renderSizes({ hue: 160, text: '验证' }, [256, 128, 64, 48, 32, 24, 16]);

  const r1 = await applyIconToFolder(dir, sizes);
  check('ico 已写入', fs.existsSync(r1.icoPath));
  const ini1 = decodeIni(await fsp.readFile(r1.iniPath));
  check('desktop.ini 指向图标', ini1.includes(`IconResource=${r1.icoPath},0`));

  const fFlags = await attribFlags(dir);
  const iFlags = await attribFlags(r1.iniPath);
  const oFlags = await attribFlags(r1.icoPath);
  check('文件夹获得 S 属性', fFlags.has('S'), [...fFlags].join(''));
  check('desktop.ini 获得 S+H', iFlags.has('S') && iFlags.has('H'), [...iFlags].join(''));
  check('ico 获得隐藏属性', oFlags.has('H'), [...oFlags].join(''));

  await applyIconToFolder(dir, sizes);
  const ini2 = decodeIni(await fsp.readFile(r1.iniPath));
  check('幂等：应用两次 ini 内容一致', ini2 === ini1);

  const st = await readFolderCustomization(dir);
  check('readFolderCustomization 报告已换装', st.customized && st.icoExists && st.hasIconResource);

  const res = await restoreFolderIcon(dir);
  check('还原报告有变更', res.changed === true);
  check('ico 已删除', !fs.existsSync(r1.icoPath));
  check('desktop.ini 已删除', !fs.existsSync(r1.iniPath));
  const res2 = await restoreFolderIcon(dir);
  check('幂等：再次还原 changed=false', res2.changed === false);

  await fsp.rm(dir, { recursive: true, force: true });
});

console.log(`\n结果：${passed} 通过，${failures.length} 失败`);
if (failures.length) {
  console.log('失败项：\n - ' + failures.join('\n - '));
  process.exit(1);
}
