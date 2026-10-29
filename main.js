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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
