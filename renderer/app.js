'use strict';

/* global FolderArt, PRESETS, api */

const $ = (id) => document.getElementById(id);

const els = {
  logo: $('logo'),
  preview: $('preview'),
  folderLabel: $('folder-label'),
  folder: $('folder'),
  pathShell: $('path-shell'),
  browse: $('browse'),
  hue: $('hue'),
  shuffle: $('shuffle'),
  text: $('text'),
  clearText: $('clear-text'),
  undo: $('undo'),
  restore: $('restore'),
  apply: $('apply'),
  badge: $('state-badge'),
  cats: $('cats'),
  grid: $('grid'),
  import: $('import'),
  count: $('count'),
  toast: $('toast'),
  dropOverlay: $('drop-overlay'),
};

const state = {
  folder: '',
  spec: { hue: 210, text: '', image: null },
  selectedPreset: '经典',
  dragDepth: 0,
};

let toastTimer = null;
function toast(msg, type) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('error', type === 'error');
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function errorMessage(err) {
  const m = String((err && err.message) || err);
  return m.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

/* ---------- 预览绘制 ---------- */

const previewCtx = els.preview.getContext('2d');
let previewScheduled = false;

function schedulePreview() {
  if (previewScheduled) return;
  previewScheduled = true;
  requestAnimationFrame(() => {
    previewScheduled = false;
    Promise.resolve(FolderArt.drawFolderIcon(previewCtx, 1024, state.spec)).catch((err) => {
      toast(errorMessage(err), 'error');
    });
  });
}

/* ---------- 应用图标生成：1024 主图 → 逐级减半得到小尺寸 ---------- */

const ICON_SIZES = [256, 128, 64, 48, 32, 24, 16];

async function renderIconSizes(spec) {
  const master = document.createElement('canvas');
  master.width = 1024;
  master.height = 1024;
  await FolderArt.drawFolderIcon(master.getContext('2d'), 1024, spec);

  const chain = {};
  let prev = master;
  let prevSize = 1024;
  const targets = [...ICON_SIZES].sort((a, b) => b - a).concat([1024]);
  for (const size of targets) {
    let canvas;
    if (prevSize === size) {
      canvas = prev;
    } else {
      canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(prev, 0, 0, prevSize, prevSize, 0, 0, size, size);
    }
    chain[size] = canvas;
    prev = canvas;
    prevSize = size;
  }

  const out = {};
  for (const size of ICON_SIZES) {
    const blob = await new Promise((resolve) => chain[size].toBlob(resolve, 'image/png'));
    out[size] = new Uint8Array(await blob.arrayBuffer());
  }
  return out;
}

/* ---------- 文件夹选择与状态 ---------- */

function undoKey(folder) {
  return `fd:last:${folder}`;
}

// 撤销数据落库：图片 dataUrl 可能超出 localStorage 配额，降级为只存色相与文字
function saveUndo(spec) {
  const full = { hue: spec.hue, text: spec.text, image: spec.image || null };
  try {
    localStorage.setItem(undoKey(state.folder), JSON.stringify(full));
  } catch {
    try {
      localStorage.setItem(undoKey(state.folder), JSON.stringify({ hue: full.hue, text: full.text, image: null }));
    } catch {}
  }
}

function showWarnings(warnings, succeedMsg) {
  if (warnings && warnings.length) {
    toast(`${succeedMsg}（注意：${warnings[0]}）`, 'error');
  } else {
    toast(succeedMsg);
  }
}

function syncControls() {
  els.hue.value = String(Math.round(state.spec.hue));
  els.text.value = state.spec.text;
}

function setFolder(p) {
  state.folder = p;
  els.folder.value = p;
  els.folderLabel.textContent = p.split(/[\\/]/).filter(Boolean).pop() || p;
  els.apply.disabled = false;
  refreshFolderState();
}

async function refreshFolderState() {
  try {
    const st = await api.getState(state.folder);
    els.restore.disabled = !st.customized;
    els.badge.hidden = !st.customized;
    if (st.customized) {
      els.badge.textContent = '✓ 当前已换装';
      els.badge.classList.remove('warn');
    }
  } catch {
    els.restore.disabled = true;
    els.badge.hidden = true;
  }
  const hadHistory = localStorage.getItem(undoKey(state.folder)) !== null;
  els.undo.disabled = !hadHistory;
}

async function browseFolder() {
  const p = await api.pickFolder();
  if (p) setFolder(p);
}

async function useImportedImage() {
  const dataUrl = await api.pickImage();
  if (!dataUrl) return;
  state.spec = { hue: state.spec.hue, text: '', image: dataUrl };
  state.selectedPreset = null;
  markSelected();
  syncControls();
  schedulePreview();
}

/* ---------- 应用 / 撤销 / 恢复 ---------- */

async function applyToFolder() {
  if (!state.folder) {
    els.pathShell.classList.add('shake');
    setTimeout(() => els.pathShell.classList.remove('shake'), 400);
    toast('请先选择要换装的文件夹', 'error');
    return;
  }
  els.apply.disabled = true;
  try {
    const sizes = await renderIconSizes(state.spec);
    const result = await api.applyIcon(state.folder, sizes);
    saveUndo(state.spec);
    els.undo.disabled = false;
    showWarnings(result && result.warnings, `已应用到「${els.folderLabel.textContent}」，去资源管理器看看吧`);
    await refreshFolderState();
  } catch (err) {
    toast(errorMessage(err), 'error');
  } finally {
    els.apply.disabled = false;
  }
}

function undoLastApply() {
  const raw = localStorage.getItem(undoKey(state.folder));
  if (!raw) return;
  try {
    const spec = JSON.parse(raw);
    if (typeof spec.hue !== 'number' || typeof spec.text !== 'string') throw new Error('bad spec');
    state.spec = { hue: spec.hue, text: spec.text, image: spec.image || null };
    state.selectedPreset = null;
    markSelected();
    syncControls();
    schedulePreview();
    toast('已载入上次应用的样式，点「应用」生效');
  } catch {
    localStorage.removeItem(undoKey(state.folder));
    els.undo.disabled = true;
  }
}

async function restoreDefault() {
  if (!state.folder) return;
  els.restore.disabled = true;
  try {
    const r = await api.restoreIcon(state.folder);
    showWarnings(r && r.warnings, r.changed ? '已恢复默认图标' : '这个文件夹本来就没有换装');
    await refreshFolderState();
  } catch (err) {
    els.restore.disabled = false;
    toast(errorMessage(err), 'error');
  }
}

/* ---------- 预设图库 ---------- */

function markSelected() {
  for (const tile of els.grid.children) {
    tile.classList.toggle('selected', tile.dataset.preset === String(state.selectedPreset));
  }
}

function selectPreset(p) {
  state.spec = { hue: p.hue, text: p.emoji, image: null };
  state.selectedPreset = p.name;
  markSelected();
  syncControls();
  schedulePreview();
}

function buildGallery() {
  const cats = ['全部', ...new Set(window.PRESETS.map((p) => p.cat))];
  for (const cat of cats) {
    const btn = document.createElement('button');
    btn.className = 'cat' + (cat === '全部' ? ' active' : '');
    btn.textContent = cat === '全部' ? `全部 · ${window.PRESETS.length}` : cat;
    btn.addEventListener('click', () => {
      for (const c of els.cats.children) c.classList.remove('active');
      btn.classList.add('active');
      renderTiles(cat);
    });
    els.cats.appendChild(btn);
  }
  renderTiles('全部');
}

function renderTiles(cat) {
  els.grid.textContent = '';
  const items = cat === '全部' ? window.PRESETS : window.PRESETS.filter((p) => p.cat === cat);
  for (const p of items) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.preset = p.name;
    tile.title = `${p.name}${p.hue !== undefined ? ` · 色相 ${p.hue}` : ''}`;
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    tile.appendChild(canvas);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    tile.appendChild(name);
    tile.addEventListener('click', () => selectPreset(p));
    els.grid.appendChild(tile);
    FolderArt.drawFolderIcon(canvas.getContext('2d'), 200, { hue: p.hue, text: p.emoji, image: null }).catch(() => {});
  }
  els.count.textContent = `${items.length} 张`;
  markSelected();
}

/* ---------- 拖放 ---------- */

function showDrop(on) {
  els.dropOverlay.hidden = !on;
}

function setupDrag() {
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    state.dragDepth++;
    showDrop(true);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) showDrop(false);
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    state.dragDepth = 0;
    showDrop(false);
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const p = api.pathForFile(file);
    if (!p) {
      toast('无法读取拖入的路径', 'error');
      return;
    }
    try {
      const res = await api.ingestDrop(p);
      if (res.type === 'folder') {
        setFolder(res.path);
        toast(`已选择文件夹「${res.path.split(/[\\/]/).pop()}」`);
      } else {
        state.spec = { hue: state.spec.hue, text: '', image: res.dataUrl };
        state.selectedPreset = null;
        markSelected();
        syncControls();
        schedulePreview();
        toast('已载入图片封面');
      }
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  });
}

/* ---------- 事件绑定 ---------- */

els.logo && FolderArt.drawFolderIcon(els.logo.getContext('2d'), 72, { hue: 258, text: '', image: null });

els.browse.addEventListener('click', browseFolder);
els.hue.addEventListener('input', () => {
  state.spec.hue = Number(els.hue.value);
  schedulePreview();
});
els.shuffle.addEventListener('click', () => {
  state.spec.hue = Math.floor(Math.random() * 360);
  syncControls();
  schedulePreview();
});
els.text.addEventListener('input', () => {
  state.spec.text = els.text.value.trim();
  schedulePreview();
});
els.clearText.addEventListener('click', () => {
  state.spec.text = '';
  syncControls();
  schedulePreview();
});
els.apply.addEventListener('click', applyToFolder);
els.undo.addEventListener('click', undoLastApply);
els.restore.addEventListener('click', restoreDefault);
els.import.addEventListener('click', useImportedImage);
els.folder.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && els.folder.value.trim()) setFolder(els.folder.value.trim());
});

setupDrag();
buildGallery();
syncControls();
schedulePreview();
