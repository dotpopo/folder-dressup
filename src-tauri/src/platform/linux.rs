// Linux：文件夹内写 .directory（freedesktop Desktop Entry），Icon 指向 PNG 绝对路径。
// GNOME(Nautilus)、KDE(Dolphin)、Thunar、Nemo 等均识别。

use std::fs;
use std::path::Path;

use super::{dir_icons, short_hash, write_atomic, Sizes, StateInfo};

const DIRECTORY_FILE: &str = ".directory";

fn png_for(sizes: &Sizes) -> Result<&Vec<u8>, String> {
    sizes
        .get(&256)
        .or_else(|| sizes.iter().max_by_key(|(k, _)| **k).map(|(_, v)| v))
        .ok_or_else(|| "缺少图标数据".to_string())
}

pub fn apply(dir: &Path, sizes: &Sizes) -> Result<String, String> {
    let png = png_for(sizes)?;
    let icon_path = dir.join(format!("{}-{}.png", super::ICON_PREFIX, short_hash(png)));
    write_atomic(&icon_path, png)?;

    let entry = format!(
        "[Desktop Entry]\nType=Directory\nIcon={}\n",
        icon_path.display()
    );
    write_atomic(&dir.join(DIRECTORY_FILE), entry.as_bytes())?;

    for old in dir_icons(dir) {
        if old != icon_path {
            let _ = fs::remove_file(old);
        }
    }
    Ok(icon_path.display().to_string())
}

pub fn restore(dir: &Path) -> Result<bool, String> {
    let mut changed = false;
    let meta = dir.join(DIRECTORY_FILE);
    if meta.exists() {
        fs::remove_file(&meta).map_err(|e| e.to_string())?;
        changed = true;
    }
    let icons = dir_icons(dir);
    if !icons.is_empty() {
        changed = true;
        for ico in icons {
            let _ = fs::remove_file(ico);
        }
    }
    Ok(changed)
}

pub fn state(dir: &Path) -> Result<StateInfo, String> {
    let has_meta = dir.join(DIRECTORY_FILE).exists();
    let ico_exists = !dir_icons(dir).is_empty();
    Ok(StateInfo {
        customized: has_meta || ico_exists,
        ico_exists,
        has_icon_resource: has_meta,
    })
}
