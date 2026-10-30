// 平台层：三个系统的"给文件夹换图标"机制完全不同。
// Windows: desktop.ini + .ico + 文件属性 + SHChangeNotify
// macOS:   NSWorkspace setIcon（写入文件夹的 Icon\r 资源）
// Linux:   文件夹内 .directory 文件指向 PNG（GNOME/KDE/Thunar 等均支持）

use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[cfg(windows)]
pub mod windows;
#[cfg(windows)]
pub use windows as imp;

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
pub use macos as imp;

#[cfg(all(unix, not(target_os = "macos")))]
pub mod linux;
#[cfg(all(unix, not(target_os = "macos")))]
pub use linux as imp;

pub const ICON_PREFIX: &str = ".diricon";

pub fn assert_folder(folder: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(folder);
    if !p.is_absolute() {
        return Err("请提供文件夹的绝对路径".into());
    }
    if !p.is_dir() {
        return Err(format!("文件夹不存在：{}", folder));
    }
    Ok(p)
}

/// 先写临时文件再改名，避免中途失败留下半个文件
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path)
        .or_else(|_| {
            let _ = std::fs::remove_file(path);
            std::fs::rename(&tmp, path)
        })
        .map_err(|e| e.to_string())
}

pub fn short_hash(bytes: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    let mut h = Sha1::new();
    h.update(bytes);
    let d = h.finalize();
    d.iter().take(5).map(|b| format!("{:02x}", b)).collect()
}

/// 目录下已有的图标文件（用于清理与状态判断）
pub fn dir_icons(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(ICON_PREFIX))
                .unwrap_or(false)
        })
        .collect()
}

#[derive(serde::Serialize)]
pub struct StateInfo {
    pub customized: bool,
    pub ico_exists: bool,
    pub has_icon_resource: bool,
}

pub type Sizes = HashMap<u32, Vec<u8>>;
