'use strict';

// Tauri 适配层：把渲染器用到的 window.api 映射到 Rust 命令。
// Electron 下 preload 已注入 window.api，这里直接跳过。

(function () {
  if (window.api || !window.__TAURI__) return;

  const invoke = window.__TAURI__.core.invoke;
  const toB64 = (u8) => {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s);
  };

  window.api = {
    pickFolder: () => invoke('pick_folder'),
    pickImage: () => invoke('pick_image'),
    ingestDrop: (p) => invoke('ingest_drop', { path: p }),
    applyIcon: (folder, sizes) => {
      const payload = {};
      for (const [k, v] of Object.entries(sizes)) payload[k] = toB64(v);
      return invoke('apply_icon', { folder, sizes: payload });
    },
    restoreIcon: (folder) => invoke('restore_icon', { folder }),
    getState: (folder) => invoke('get_state', { folder }),
    forceRefresh: (folder) => invoke('force_refresh', { folder }),
    listSubdirs: (parent, offset, limit, query) => invoke('list_subdirs', { parent, offset, limit, query }),
    parentDir: (path) => invoke('parent_dir', { path }),
    openInExplorer: (path) => invoke('open_in_explorer', { path }),
    packsList: () => invoke('packs_list'),
    packFiles: (dir) => invoke('pack_files', { dir }),
    packImage: (dir, file) => invoke('pack_image', { dir, file }),
    addPackFolder: () => invoke('add_pack_folder'),
    importPackFolder: () => invoke('import_pack_folder'),
    pathForFile: (file) => (file && file.path ? file.path : null),
  };

  // 原生拖放：Tauri 提供真实路径
  try {
    const { getCurrentWebview } = window.__TAURI__.webview;
    const overlay = () => document.getElementById('drop-overlay');
    getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === 'enter' || p.type === 'over') overlay()?.removeAttribute('hidden');
      else overlay()?.setAttribute('hidden', '');
      if (p.type === 'drop' && p.paths && p.paths.length) {
        window.dispatchEvent(new CustomEvent('fd-drop-path', { detail: p.paths[0] }));
      }
    });
  } catch (err) {
    console.warn('拖放初始化失败', err);
  }
})();
