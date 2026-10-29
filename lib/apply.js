'use strict';

// Windows 文件夹图标应用与还原。
// 原理：目标文件夹内写入隐藏的 .diricon.ico，desktop.ini 的
// [.ShellClassInfo] IconResource 指向它，文件夹加 System 属性，
// 最后 SHChangeNotify 让 Explorer 立即重读。应用操作幂等。

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { buildIco } = require('./ico');

const execFileP = promisify(execFile);
const ICON_PREFIX = '.diricon';
const INI_NAME = 'desktop.ini';

async function assertFolder(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) {
    throw new Error('请提供文件夹的绝对路径');
  }
  let st;
  try {
    st = await fsp.stat(folder);
  } catch {
    throw new Error('文件夹不存在：' + folder);
  }
  if (!st.isDirectory()) throw new Error('目标不是文件夹：' + folder);
}

function encodeIni(content) {
  // Explorer 要求 desktop.ini 为带 BOM 的 UTF-16LE 才能正确处理非 ASCII 路径
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]);
}

function decodeIni(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  return buf.toString('utf8');
}

// 纯函数：在 desktop.ini 内容中幂等地 upsert IconResource 行
function upsertIconResource(content, icoPath) {
  const lines = content.length ? content.split(/\r?\n/) : [];
  const line = `IconResource=${icoPath},0`;
  const sectionIdx = lines.findIndex((l) => l.trim().toLowerCase() === '[.shellclassinfo]');
  if (sectionIdx === -1) {
    const out = lines.filter((l) => l.trim().length > 0);
    while (out.length && out[out.length - 1].trim().length === 0) out.pop();
    if (out.length) out.push('');
    out.push('[.ShellClassInfo]', line, '');
    return out.join('\r\n');
  }
  let end = lines.length;
  for (let i = sectionIdx + 1; i < lines.length; i++) {
    if (/^\s*\[.*\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let replaced = false;
  for (let i = sectionIdx + 1; i < end; i++) {
    if (/^\s*IconResource\s*=/i.test(lines[i])) {
      lines[i] = line;
      replaced = true;
      break;
    }
  }
  if (!replaced) lines.splice(end, 0, line);
  return lines.join('\r\n');
}

// 纯函数：从 desktop.ini 内容中移除 IconResource 行；区块因此为空则整个移除
function removeIconResource(content) {
  const lines = content.split(/\r?\n/);
  const kept = [];
  let removed = false;
  for (const l of lines) {
    if (/^\s*IconResource\s*=/i.test(l)) {
      removed = true;
      continue;
    }
    kept.push(l);
  }
  if (!removed) return { content, removed: false };
  const cleaned = kept.filter((l, i, arr) => !(l.trim() === '' && arr[i - 1] && /^\s*\[/.test(arr[i - 1]) && arr.slice(i + 1).every((x) => x.trim() === '')));
  let out = cleaned.join('\r\n');
  if (/^\s*\[\.ShellClassInfo\]\s*$/im.test(out) && out.replace(/^\s*\[\.ShellClassInfo\]\s*$/im, '').trim() === '') {
    out = '';
  }
  return { content: out, removed: true };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 同目录写临时文件后 rename 覆盖：rename 可替换隐藏目标，且中途崩溃不会损坏旧文件
async function writeWithRetry(filePath, data, attempts = 4) {
  const tmp = `${filePath}.dressup-tmp`;
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, filePath);
      return;
    } catch (err) {
      lastErr = err;
      await fsp.unlink(tmp).catch(() => {});
      if (err.code !== 'EBUSY' && err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
      await sleep(150 * i);
    }
  }
  throw lastErr;
}

// 返回 'deleted' 或 'missing'，供调用方区分"删了"与"本来没有"
async function unlinkWithRetry(filePath, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await fsp.unlink(filePath);
      return 'deleted';
    } catch (err) {
      if (err.code === 'ENOENT') return 'missing';
      if (i === attempts) throw err;
      if (err.code !== 'EBUSY' && err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
      await sleep(150 * i);
    }
  }
}

async function attrib(flags, target) {
  await execFileP('attrib', [...flags.split(/\s+/), target]);
}

// PowerShell 单引号字面量：反斜杠不是转义符，只有 ' 需要翻倍。
// 绝不能用 JSON.stringify——它会把 \ 变成 \\，而 PS 会把 \\ 当成字面双分隔符传给 Shell API。
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function notifyShell(folder) {
  const script = [
    `Add-Type -Namespace W -Name N -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, int f, IntPtr a, IntPtr b);'`,
    `$p1 = [Runtime.InteropServices.Marshal]::StringToHGlobalUni(${psQuote(folder)})`,
    `$p2 = [Runtime.InteropServices.Marshal]::StringToHGlobalUni(${psQuote(path.dirname(folder))})`,
    `[W.N]::SHChangeNotify(0x00001000, 0x1005, $p1, [IntPtr]::Zero)`,
    `[W.N]::SHChangeNotify(0x00001000, 0x1005, $p2, [IntPtr]::Zero)`,
  ].join('; ');
  try {
    await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000 });
  } catch (err) {
    // 刷新失败不影响写入结果，Explorer 重启/手动 F5 后同样生效
    return { refreshed: false, error: String(err.message || err) };
  }
  return { refreshed: true };
}

// 图标文件按内容哈希命名：Explorer 对同路径图标有缓存，
// 内容变了路径也变，才会重新加载；同内容同哈希保证幂等。
function icoNameFor(icoBuf) {
  const hash = crypto.createHash('sha1').update(icoBuf).digest('hex').slice(0, 10);
  return `${ICON_PREFIX}-${hash}.ico`;
}

async function removeDirIcons(folder, keepName) {
  const entries = await fsp.readdir(folder).catch(() => []);
  let removed = 0;
  for (const name of entries) {
    if (name.startsWith(ICON_PREFIX) && name.endsWith('.ico') && name !== keepName) {
      const wasThere = await unlinkWithRetry(path.join(folder, name));
      if (wasThere === 'deleted') removed++;
    }
  }
  return removed;
}

async function hasDirIcon(folder) {
  const entries = await fsp.readdir(folder).catch(() => []);
  return entries.some((n) => n.startsWith(ICON_PREFIX) && n.endsWith('.ico'));
}

// sizes: { [size]: Uint8Array }；返回 { icoPath, iniPath, refresh, warnings }
async function applyIconToFolder(folder, sizes) {
  await assertFolder(folder);
  const icoBuf = await buildIco(sizes);
  const icoName = icoNameFor(icoBuf);
  const icoPath = path.join(folder, icoName);
  const iniPath = path.join(folder, INI_NAME);
  await removeDirIcons(folder, icoName);
  await writeWithRetry(icoPath, icoBuf);

  let content = '';
  try {
    content = decodeIni(await fsp.readFile(iniPath));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  // 无 BOM 且按 UTF-8 解出替换符：多半是旧工具写的 ANSI/GBK，合并会不可逆损坏其中内容
  if (content.includes('\uFFFD')) {
    throw new Error('该文件夹的 desktop.ini 使用了旧编码格式，为避免破坏其中内容未做修改。请手动清理后再试。');
  }
  const next = upsertIconResource(content, icoPath);
  await writeWithRetry(iniPath, encodeIni(next));

  const warnings = [];
  try {
    await attrib('+s +h', iniPath);
  } catch (err) {
    warnings.push('desktop.ini 属性设置失败：' + err.message);
  }
  try {
    await attrib('+h', icoPath);
  } catch (err) {
    warnings.push('图标文件隐藏失败：' + err.message);
  }
  try {
    await attrib('+s', folder);
  } catch (err) {
    throw new Error('无法设置文件夹系统属性（可能没有写入权限），图标可能不生效：' + err.message);
  }

  const refresh = await notifyShell(folder);
  if (!refresh.refreshed) warnings.push('已写入，但资源管理器刷新通知失败，可能需要手动刷新（F5）');
  return { icoPath, iniPath, refresh, warnings };
}

async function restoreFolderIcon(folder) {
  await assertFolder(folder);
  const iniPath = path.join(folder, INI_NAME);

  const removedIcons = await removeDirIcons(folder, null);
  let existed = removedIcons > 0;

  let content = '';
  try {
    content = decodeIni(await fsp.readFile(iniPath));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (content.includes('\uFFFD')) {
    // 只清理图标文件，不去改无法安全解析的 desktop.ini
    await notifyShell(folder);
    return { changed: existed, warnings: ['desktop.ini 是旧编码格式，已移除图标文件但未改写它'] };
  }
  const { content: next, removed } = removeIconResource(content);
  if (removed) {
    existed = true;
    if (next.trim() === '') {
      await unlinkWithRetry(iniPath);
    } else {
      await writeWithRetry(iniPath, encodeIni(next));
      try {
        await attrib('+s +h', iniPath);
      } catch (err) {
        /* 还原时属性设置失败无碍 */
      }
    }
  }
  const warnings = [];
  try {
    await attrib('-s', folder);
  } catch (err) {
    warnings.push('文件夹系统属性还原失败：' + err.message);
  }
  await notifyShell(folder);
  return { changed: existed, warnings };
}

async function readFolderCustomization(folder) {
  await assertFolder(folder);
  const iniPath = path.join(folder, INI_NAME);
  const icoExists = await hasDirIcon(folder);
  let hasIconResource = false;
  try {
    const content = decodeIni(await fsp.readFile(iniPath));
    hasIconResource = /^\s*IconResource\s*=/im.test(content);
  } catch {}
  return { customized: icoExists || hasIconResource, icoExists, hasIconResource };
}

async function ingestDroppedPath(p) {
  if (typeof p !== 'string' || p.length === 0) throw new Error('无效的拖入路径');
  let st;
  try {
    st = await fsp.stat(p);
  } catch {
    throw new Error('路径不存在：' + p);
  }
  if (st.isDirectory()) return { type: 'folder', path: p };
  const ext = path.extname(p).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
    if (st.size > 10 * 1024 * 1024) throw new Error('图片超过 10MB');
    const buf = await fsp.readFile(p);
    const mime = ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
    return { type: 'image', path: p, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  }
  throw new Error('请拖入文件夹或图片');
}

module.exports = {
  applyIconToFolder,
  restoreFolderIcon,
  readFolderCustomization,
  ingestDroppedPath,
  upsertIconResource,
  removeIconResource,
  encodeIni,
  decodeIni,
  psQuote,
  icoNameFor,
  INI_NAME,
};
