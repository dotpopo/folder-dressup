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

function selectFolder(p) {
  state.folder = p;
  els.folderLabel.textContent = p.split(/[\/]/).filter(Boolean).pop() || p;
  els.apply.disabled = false;
  els.refresh.disabled = false;
  refreshFolderState();
}

function setFolder(p) {
  // 选择目录 = 切换浏览位置；目标由右侧列表点击决定
  return setBrowseRoot(p);
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
    toast('请先在右侧「子文件夹」里点选一个文件夹', 'error');
    return;
  }
  els.apply.disabled = true;
  try {
    // 应用前备份，供「撤销修改」整格回退
    if (api.backupFolder) {
      try { await api.backupFolder(state.folder); } catch {}
    }
    const sizes = await renderIconSizes(state.spec);
    const result = await api.applyIcon(state.folder, sizes);
    saveUndo(state.spec);
    state.lastApplied = state.folder;
    state.batchUndo = null;
    els.undo.disabled = false;
    showWarnings(result && result.warnings, `已应用到「${els.folderLabel.textContent}」；图标没变就点「刷新图标」`);
    await refreshFolderState();
    if (fb.root) await loadSubdirs();
  } catch (err) {
    toast(errorMessage(err), 'error');
  } finally {
    els.apply.disabled = false;
  }
}

async function undoLastApply() {
  // 一键换装的批量撤销
  if (state.batchUndo && state.batchUndo.length && api.restoreFolderBackup) {
    const list = state.batchUndo.slice();
    state.batchUndo = null;
    els.undo.disabled = true;
    els.batchBar.hidden = false;
    els.batchFill.style.width = '0%';
    let n = 0;
    for (const f of list) {
      try { await api.restoreFolderBackup(f); } catch {}
      n++;
      els.batchFill.style.width = Math.round((n / list.length) * 100) + '%';
    }
    els.batchBar.hidden = true;
    toast('已撤销 ' + list.length + ' 个文件夹的换装');
    if (fb.root) await loadSubdirs();
    return;
  }
  // 单次应用的撤销：从备份还原
  if (state.lastApplied && api.restoreFolderBackup) {
    const target = state.lastApplied;
    state.lastApplied = null;
    els.undo.disabled = true;
    try {
      await api.restoreFolderBackup(target);
      localStorage.removeItem(undoKey(target));
      toast('已撤销上次换装');
      if (state.folder === target) await refreshFolderState();
      if (fb.root) await loadSubdirs();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
    return;
  }

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
  els.refresh.disabled = true;
  toast('正在重启资源管理器…');
  try {
    if (api.restartExplorer) {
      await api.restartExplorer();
      toast('资源管理器已重启，图标已更新');
    } else {
      await api.forceRefresh(state.folder);
      toast('已请求资源管理器刷新');
    }
  } catch (err) {
    toast(errorMessage(err), 'error');
  } finally {
    els.refresh.disabled = false;
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


/* ---------- 子文件夹浏览（与皮肤同屏，无需切换） ---------- */

Object.assign(els, {
  goUp: $('go-up'),
  fbUp: $('fb-up'),
  fbQ: $('fb-q'),
  fbTotal: $('fb-total'),
  fbGrid: $('fb-grid'),
  fbPrev: $('fb-prev'),
  fbPage: $('fb-page'),
  fbNext: $('fb-next'),
});

const fb = { root: '', offset: 0, limit: 24, query: '', total: 0 };

function parentOf(p) {
  const s = String(p || '').replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i > 0 ? s.slice(0, i) : '';
}

/** 切换正在浏览的目录（路径行显示的就是它） */
async function setBrowseRoot(root) {
  fb.root = root;
  fb.offset = 0;
  fb.query = '';
  if (els.fbQ) els.fbQ.value = '';
  els.folder.value = root;
  clearTarget();
  await loadSubdirs();
  // 目录里没有子文件夹时，把这个目录本身作为目标（否则无从选择）
  if (fb.total === 0 && root) {
    selectFolder(root);
    toast('这个目录没有子文件夹，已选中它本身');
  }
}

/** 清空当前目标（浏览目录时用），未选目标不允许应用 */
function clearTarget() {
  state.folder = '';
  state.selectedPreset = state.selectedPreset;
  els.folderLabel.textContent = '尚未选择文件夹';
  els.apply.disabled = true;
  els.restore.disabled = true;
  els.badge.hidden = true;
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
    el.title = item.path + '\n单击选中 · 双击进入';
    if (item.icon) {
      const img = document.createElement('img');
      img.src = item.icon;
      img.alt = item.name;
      el.appendChild(img);
    } else {
      const cv = document.createElement('canvas');
      cv.width = 120;
      cv.height = 120;
      el.appendChild(cv);
      FolderArt.drawFolderIcon(cv.getContext('2d'), 120, { hue: 210, text: '', image: null }).catch(() => {});
    }
    const nm = document.createElement('span');
    nm.className = 'fb-name';
    nm.textContent = item.name;
    el.appendChild(nm);
    el.addEventListener('click', () => {
      selectFolder(item.path);
      for (const c of els.fbGrid.children) c.classList.remove('selected');
      el.classList.add('selected');
    });
    el.addEventListener('dblclick', () => {
      selectFolder(item.path);
      setBrowseRoot(item.path);
    });
    els.fbGrid.appendChild(el);
  }
  const pages = Math.max(1, Math.ceil(fb.total / fb.limit));
  const cur = Math.floor(fb.offset / fb.limit) + 1;
  els.fbTotal.textContent = fb.total ? `${fb.total} 个` : '';
  els.fbPage.textContent = `${cur} / ${pages}`;
  els.fbPrev.disabled = fb.offset === 0;
  els.fbNext.disabled = fb.offset + fb.limit >= fb.total;
}

// 左侧 📁：在系统资源管理器中打开当前目录（看子目录真实效果）
els.goUp.addEventListener('click', async () => {
  const dir = fb.root || (state.folder ? parentOf(state.folder) : '');
  if (!dir) {
    toast('先选择一个文件夹');
    return;
  }
  try {
    await api.openInExplorer(dir);
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
});

// 右栏 ↑：应用内返回上一级
els.fbUp.addEventListener('click', () => {
  const up = parentOf(fb.root);
  if (up) setBrowseRoot(up);
  else toast('已经是顶层目录');
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

/* ---------- 角落显示版本号 ---------- */
(async () => {
  const el = document.getElementById('version');
  if (!el) return;
  try {
    const v = api.appVersion ? await api.appVersion() : null;
    el.textContent = v ? 'v' + v : '';
  } catch {
    el.textContent = '';
  }
})();

/* ---------- 一键换装：当前目录下的所有子文件夹，随机套用当前皮肤包 ---------- */

Object.assign(els, {
  batch: $('batch'),
  batchBar: $('batch-bar'),
  batchFill: $('batch-fill'),
});

async function batchApply() {
  if (!fb.root) {
    toast('先选择一个目录');
    return;
  }
  const cat = state.activeCat || '';
  if (!cat.startsWith('pack:')) {
    toast('请先在下方选择一个皮肤包（Muse / 胖企鹅 / 阿蟹）');
    return;
  }
  const pack = packCats.find((p) => `pack:${p.dir}` === cat);
  if (!pack) {
    toast('皮肤包未找到');
    return;
  }

  let files;
  try {
    files = await api.packFiles(pack.dir);
  } catch (err) {
    toast(errorMessage(err), 'error');
    return;
  }
  if (!files.length) {
    toast('这个皮肤包里没有图片');
    return;
  }

  const page = await api.listSubdirs(fb.root, 0, 200, '');
  const targets = page.items.map((i) => i.path);
  if (!targets.length) {
    toast('这个目录下没有子文件夹');
    return;
  }
  const ok = window.confirm(
    `将用「${pack.name}」的皮肤随机换装 ${targets.length} 个子文件夹，背景色取当前调色盘。\n\n继续吗？`
  );
  if (!ok) return;

  els.batch.disabled = true;
  els.batchBar.hidden = false;
  els.batchFill.style.width = '0%';
  let done = 0;
  let failed = 0;

  for (const folder of targets) {
    const file = files[Math.floor(Math.random() * files.length)];
    try {
      if (api.backupFolder) await api.backupFolder(folder);
      const dataUrl = await api.packImage(pack.dir, file);
      const spec = { hue: state.spec.hue, text: '', image: dataUrl };
      const sizes = await renderIconSizes(spec);
      await api.applyIcon(folder, sizes);
      done++;
    } catch {
      failed++;
    }
    const pct = Math.round(((done + failed) / targets.length) * 100);
    els.batchFill.style.width = pct + '%';
    if ((done + failed) % 5 === 0) {
      toast(`正在换装 ${done + failed}/${targets.length}`);
    }
  }

  els.batchBar.hidden = true;
  els.batch.disabled = false;
  state.batchUndo = targets.slice();
  els.undo.disabled = false;
  toast(failed ? `完成：成功 ${done} 个，失败 ${failed} 个` : `已换装 ${done} 个子文件夹，图标没变就点「刷新图标」`);
  await loadSubdirs();
  if (state.folder) refreshFolderState();
}

els.batch.addEventListener('click', batchApply);
