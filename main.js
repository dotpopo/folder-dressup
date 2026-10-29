'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const {
  applyIconToFolder,
  restoreFolderIcon,
  readFolderCustomization,
  ingestDroppedPath,
} = require('./lib/apply');

const ALLOWED_SIZES = new Set([16, 24, 32, 48, 64, 128, 256]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);
const PACK_MAX_FILES = 60;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// dev 与打包版统一 userData，皮肤包目录才能一致
app.setPath('userData', path.join(app.getPath('appData'), '文件夹换装'));

let win = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: '文件夹换装',
    backgroundColor: '#f4f5f7',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'app.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => {
    win = null;
  });
}

function userError(msg) {
  const err = new Error(msg);
  err.userFacing = true;
  return err;
}

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择要换装的文件夹',
    properties: ['openDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  });
  if (r.canceled) return null;
  const res = await ingestDroppedPath(r.filePaths[0]);
  return res.dataUrl;
});

ipcMain.handle('ingest-drop', async (e, p) => {
  return ingestDroppedPath(p);
});

ipcMain.handle('apply-icon', async (e, payload) => {
  const folder = payload && payload.folder;
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw userError('请先选择文件夹');
  const sizes = payload && payload.sizes;
  if (!sizes || typeof sizes !== 'object') throw userError('图标数据缺失');
  const clean = {};
  for (const [key, value] of Object.entries(sizes)) {
    const size = Number(key);
    if (!ALLOWED_SIZES.has(size)) continue;
    if (!(value instanceof Uint8Array)) throw userError('图标数据格式错误');
    if (value.byteLength === 0 || value.byteLength > 8 * 1024 * 1024) throw userError('图标数据大小异常');
    clean[size] = value;
  }
  if (!clean[256]) throw userError('缺少 256px 图标数据');
  return applyIconToFolder(folder, clean);
});

ipcMain.handle('restore-icon', async (e, payload) => {
  const folder = payload && payload.folder;
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw userError('请先选择文件夹');
  return restoreFolderIcon(folder);
});

ipcMain.handle('get-state', async (e, payload) => {
  const folder = payload && payload.folder;
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw userError('请先选择文件夹');
  return readFolderCustomization(folder);
});

/* ---------- 皮肤包 ---------- */

function packsDir() {
  return path.join(app.getPath('userData'), 'packs');
}

async function scanPackDir(dir) {
  const st = await fsp.stat(dir).catch(() => null);
  if (!st || !st.isDirectory()) return null;
  const names = (await fsp.readdir(dir).catch(() => []))
    .filter((n) => IMAGE_EXTS.has(path.extname(n).toLowerCase()))
    .sort();
  const files = [];
  for (const name of names) {
    if (files.length >= PACK_MAX_FILES) break;
    const s = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (s && s.isFile() && s.size > 0 && s.size <= IMAGE_MAX_BYTES) files.push(name);
  }
  return files;
}

ipcMain.handle('packs-list', async () => {
  const root = packsDir();
  const entries = await fsp.readdir(root).catch(() => []);
  const packs = [];
  for (const name of entries) {
    const dir = path.join(root, name);
    const files = await scanPackDir(dir);
    if (files && files.length > 0) packs.push({ name, dir, count: files.length });
  }
  return packs;
});

ipcMain.handle('pack-files', async (e, payload) => {
  const dir = payload && payload.dir;
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw userError('皮肤包路径无效');
  const files = await scanPackDir(dir);
  if (!files) throw userError('皮肤包文件夹不存在');
  return files;
});

ipcMain.handle('pack-image', async (e, payload) => {
  const dir = payload && payload.dir;
  const file = payload && payload.file;
  if (typeof dir !== 'string' || path.isAbsolute(dir) === false) throw userError('皮肤包路径无效');
  if (typeof file !== 'string' || file !== path.basename(file) || !IMAGE_EXTS.has(path.extname(file).toLowerCase())) {
    throw userError('不是有效的图片文件');
  }
  const resolvedDir = path.resolve(dir);
  const resolved = path.resolve(resolvedDir, file);
  if (!resolved.startsWith(resolvedDir + path.sep)) throw userError('路径越界');
  const st = await fsp.stat(resolved).catch(() => null);
  if (!st || !st.isFile()) throw userError('图片不存在');
  if (st.size > IMAGE_MAX_BYTES) throw userError('图片超过 10MB');
  const buf = await fsp.readFile(resolved);
  const ext = path.extname(resolved).toLowerCase();
  const MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
  };
  return `data:${MIME[ext] || 'image/png'};base64,${buf.toString('base64')}`;
});

ipcMain.handle('add-pack-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择包含图片的文件夹（将作为一个皮肤包分类）',
    properties: ['openDirectory'],
  });
  if (r.canceled) return null;
  const dir = r.filePaths[0];
  const files = await scanPackDir(dir);
  if (!files || files.length === 0) throw userError('该文件夹里没有可用的图片');
  return { name: path.basename(dir), dir, count: files.length };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
