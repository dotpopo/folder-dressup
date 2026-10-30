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
  refresh: $('refresh'),
  apply: $('apply'),
  badge: $('state-badge'),
  cats: $('cats'),
  grid: $('grid'),
  import: $('import'),
  addPack: $('add-pack'),
  importPack: $('import-pack'),
  count: $('count'),
  toast: $('toast'),
  dropOverlay: $('drop-overlay'),
};

const state = {
  folder: '',
  spec: { hue: 210, text: '', image: null },
  selectedPreset: '经典',
  activeCat: 'all',
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
  els.refresh.disabled = false;
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

/* ---------- 预设图库（内置分类 + 皮肤包） ---------- */

let packCats = [];
const packImageCache = new Map();

const BUILTIN_CATS = [...new Set(window.PRESETS.map((p) => p.cat))];

function userPacks() {
  try {
    const v = JSON.parse(localStorage.getItem('fd:packs') || '[]');
    return Array.isArray(v) ? v.filter((p) => p && typeof p.dir === 'string' && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}

function saveUserPacks(list) {
  localStorage.setItem('fd:packs', JSON.stringify(list));
}

async function loadPackCats() {
  let disk = [];
  try {
    disk = await api.packsList();
  } catch {}
  const byDir = new Map();
  for (const p of [...(Array.isArray(disk) ? disk : []), ...userPacks()]) {
    if (p && typeof p.dir === 'string' && !byDir.has(p.dir)) byDir.set(p.dir, { name: p.name, dir: p.dir, files: null });
  }
  packCats = [...byDir.values()];
}

async function getPackFiles(pack) {
  if (pack.files) return pack.files;
  const files = await api.packFiles(pack.dir);
  pack.files = files;
  return files;
}

async function getPackImage(dir, file) {
  const key = `${dir}|${file}`;
  if (packImageCache.has(key)) return packImageCache.get(key);
  const dataUrl = await api.packImage(dir, file);
  packImageCache.set(key, dataUrl);
  return dataUrl;
}

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

async function applyPackImage(dir, file) {
  try {
    const dataUrl = await getPackImage(dir, file);
    state.spec = { hue: state.spec.hue, text: '', image: dataUrl };
    state.selectedPreset = `pack:${dir}|${file}`;
    markSelected();
    syncControls();
    schedulePreview();
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

function catDefs() {
  return [
    { key: 'all', label: `全部 · ${window.PRESETS.length}` },
    ...BUILTIN_CATS.map((c) => ({ key: c, label: c })),
    ...packCats.map((p) => ({ key: `pack:${p.dir}`, label: p.name })),
  ];
}

function renderCats() {
  els.cats.textContent = '';
  for (const def of catDefs()) {
    const btn = document.createElement('button');
    btn.className = 'cat' + (state.activeCat === def.key ? ' active' : '');
    btn.textContent = def.label;
    btn.title = def.label;
    btn.addEventListener('click', () => setActiveCat(def.key));
    els.cats.appendChild(btn);
  }
}

function setActiveCat(key) {
  state.activeCat = key;
  for (const c of els.cats.children) c.classList.remove('active');
  const idx = catDefs().findIndex((d) => d.key === key);
  if (idx >= 0) els.cats.children[idx].classList.add('active');
  if (key === 'all') renderTiles('all');
  else if (key.startsWith('pack:')) renderPackTiles(key.slice(5));
  else renderTiles(key);
}

function buildGallery() {
  renderCats();
  setActiveCat(state.activeCat || 'all');
}

function renderTiles(cat) {
  els.grid.textContent = '';
  const items = cat === 'all' ? window.PRESETS : window.PRESETS.filter((p) => p.cat === cat);
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

function renderPackTiles(dir) {
  els.grid.textContent = '';
  const pack = packCats.find((p) => p.dir === dir);
  if (!pack) return;
  getPackFiles(pack)
    .then((files) => {
      if (state.activeCat !== `pack:${dir}`) return;
      els.count.textContent = `${files.length} 张`;
      for (const file of files) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.dataset.preset = `pack:${dir}|${file}`;
        tile.title = file;
        const img = document.createElement('img');
        img.className = 'pack-img';
        img.alt = file;
        tile.appendChild(img);
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = file.replace(/\.[^.]+$/, '');
        tile.appendChild(name);
        tile.addEventListener('click', () => applyPackImage(dir, file));
        els.grid.appendChild(tile);
        getPackImage(dir, file)
          .then((d) => {
            img.src = d;
          })
          .catch(() => {
            tile.classList.add('broken');
          });
      }
      markSelected();
    })
    .catch((err) => toast(errorMessage(err), 'error'));
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
  const handleDroppedPath = async (p) => {
    showDrop(false);
    if (!p) {
      toast('无法读取拖入的路径', 'error');
      return;
    }
    try {
      const res = await api.ingestDrop(p);
      if (res.type === 'folder') {
        setFolder(res.path);
        toast('已选择文件夹：' + res.path.split(/[\\/]/).pop());
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
  };

  window.addEventListener('fd-drop-path', (e) => handleDroppedPath(e.detail));

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    state.dragDepth = 0;
    showDrop(false);
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    await handleDroppedPath(api.pathForFile(file));
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
els.refresh.addEventListener('click', async () => {
  if (!state.folder) return;
  try {
    await api.forceRefresh(state.folder);
    toast('已请求资源管理器刷新');
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
});
els.undo.addEventListener('click', undoLastApply);
els.restore.addEventListener('click', restoreDefault);
els.import.addEventListener('click', useImportedImage);
els.importPack.addEventListener('click', async () => {
  try {
    const pack = await api.importPackFolder();
    if (!pack) return;
    await loadPackCats();
    renderCats();
    setActiveCat('pack:' + pack.dir);
    toast('已导入皮肤包「' + pack.name + '」（' + pack.count + ' 张）');
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
});
els.addPack.addEventListener('click', async () => {
  try {
    const pack = await api.addPackFolder();
    if (!pack) return;
    const list = userPacks().filter((p) => p.dir !== pack.dir);
    list.push({ name: pack.name, dir: pack.dir });
    saveUserPacks(list);
    await loadPackCats();
    renderCats();
    setActiveCat(`pack:${pack.dir}`);
    toast(`已添加皮肤包「${pack.name}」`);
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
});
els.folder.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && els.folder.value.trim()) setFolder(els.folder.value.trim());
});

setupDrag();
loadPackCats().then(buildGallery);
syncControls();
schedulePreview();

/* ---------- 文件夹浏览（双击进入 / ← 返回上级） ---------- */

Object.assign(els, {
  fbUp: $('fb-up'),
  fbPath: $('fb-path'),
  fbPick: $('fb-pick'),
  fbQ: $('fb-q'),
  fbTotal: $('fb-total'),
  fbGrid: $('fb-grid'),
  fbPrev: $('fb-prev'),
  fbPage: $('fb-page'),
  fbNext: $('fb-next'),
  skinsView: $('skins-view'),
  foldersView: $('folders-view'),
});

const fb = { root: '', offset: 0, limit: 48, query: '', total: 0 };

function switchTab(name) {
  for (const b of document.querySelectorAll('.rtab')) b.classList.toggle('active', b.dataset.tab === name);
  els.skinsView.hidden = name !== 'skins';
  els.foldersView.hidden = name !== 'folders';
  if (name === 'folders' && !fb.root) {
    if (state.folder) openFolders(state.folder);
    else toast('先选择一个目录，或点「选择…」');
  }
}

async function openFolders(root) {
  if (!root) return;
  fb.root = root;
  fb.offset = 0;
  fb.query = '';
  els.fbQ.value = '';
  els.fbPath.textContent = root;
  els.fbPath.title = root;
  els.toast.hidden = true;
  await loadSubdirs();
}

async function loadSubdirs() {
  if (!fb.root || !api.listSubdirs) return;
  els.fbGrid.textContent = '';
  let page;
  try {
    page = await api.listSubdirs(fb.root, fb.offset, fb.limit, fb.query);
  } catch (err) {
    toast(errorMessage(err), 'error');
    return;
  }
  fb.total = page.total;
  if (!page.items.length) {
    const empty = document.createElement('div');
    empty.className = 'fb-empty';
    empty.textContent = fb.query ? '没有匹配的子文件夹' : '这个目录下没有子文件夹';
    els.fbGrid.appendChild(empty);
  }
  for (const item of page.items) {
    const el = document.createElement('div');
    el.className = 'fb-item' + (item.path === state.folder ? ' selected' : '');
    el.title = item.path;
    const cv = document.createElement('canvas');
    cv.width = 160;
    cv.height = 160;
    el.appendChild(cv);
    FolderArt.drawFolderIcon(cv.getContext('2d'), 160, { hue: 210, text: '', image: null }).catch(() => {});
    const nm = document.createElement('span');
    nm.className = 'fb-name';
    nm.textContent = item.name;
    el.appendChild(nm);
    if (item.customized) {
      const badge = document.createElement('span');
      badge.className = 'fb-badge';
      badge.textContent = '已换装';
      el.appendChild(badge);
    }
    el.addEventListener('click', () => {
      setFolder(item.path);
      for (const c of els.fbGrid.children) c.classList.remove('selected');
      el.classList.add('selected');
    });
    el.addEventListener('dblclick', () => openFolders(item.path));
    els.fbGrid.appendChild(el);
  }
  const pages = Math.max(1, Math.ceil(fb.total / fb.limit));
  const cur = Math.floor(fb.offset / fb.limit) + 1;
  els.fbTotal.textContent = `${fb.total} 个子文件夹`;
  els.fbPage.textContent = `${cur} / ${pages}`;
  els.fbPrev.disabled = fb.offset === 0;
  els.fbNext.disabled = fb.offset + fb.limit >= fb.total;
}

els.fbUp.addEventListener('click', async () => {
  if (!fb.root) return;
  const p = api.parentDir ? await api.parentDir(fb.root) : null;
  if (p) openFolders(p);
  else toast('已经是顶层目录');
});

els.fbPick.addEventListener('click', async () => {
  const p = await api.pickFolder();
  if (p) openFolders(p);
});

els.fbQ.addEventListener('input', () => {
  fb.query = els.fbQ.value.trim();
  fb.offset = 0;
  loadSubdirs();
});

els.fbPrev.addEventListener('click', () => {
  fb.offset = Math.max(0, fb.offset - fb.limit);
  loadSubdirs();
});

els.fbNext.addEventListener('click', () => {
  fb.offset += fb.limit;
  loadSubdirs();
});

for (const b of document.querySelectorAll('.rtab')) {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
}

if (!api.listSubdirs) {
  const t = document.querySelector('.rtab[data-tab="folders"]');
  if (t) t.hidden = true;
}
