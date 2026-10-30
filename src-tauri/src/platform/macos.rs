// macOS：用 NSWorkspace.setIcon 给文件夹设置自定义图标（写入 Icon\r 资源）

use std::fs;
use std::path::Path;

use objc2::rc::Retained;
use objc2::ClassType;
use objc2_app_kit::{NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
use objc2_foundation::{NSData, NSString};

use super::{dir_icons, short_hash, write_atomic, Sizes, StateInfo};

fn png_for(sizes: &Sizes) -> Result<&Vec<u8>, String> {
    sizes
        .get(&256)
        .or_else(|| sizes.iter().max_by_key(|(k, _)| **k).map(|(_, v)| v))
        .ok_or_else(|| "缺少图标数据".to_string())
}

fn set_icon(dir: &Path, png: Option<&[u8]>) -> Result<(), String> {
    unsafe {
        let ns_path = NSString::from_str(&dir.to_string_lossy());
        let ws = NSWorkspace::sharedWorkspace();
        let image: Option<Retained<NSImage>> = match png {
            None => None,
            Some(bytes) => {
                let data = NSData::with_bytes(bytes);
                let obj: Retained<NSImage> =
                    NSImage::initWithData(NSImage::alloc(), &data).ok_or("图标解码失败")?;
                Some(obj)
            }
        };
        let opts = NSWorkspaceIconCreationOptions::empty();
        let ok = ws.setIcon_forFile_options(image.as_deref(), &ns_path, opts);
        if !ok {
            return Err("系统拒绝了设置图标（请确认该文件夹可写）".into());
        }
    }
    Ok(())
}

pub fn apply(dir: &Path, sizes: &Sizes) -> Result<String, String> {
    let png = png_for(sizes)?;
    let icon_path = dir.join(format!("{}-{}.png", super::ICON_PREFIX, short_hash(png)));
    write_atomic(&icon_path, png)?;
    set_icon(dir, Some(png))?;
    for old in dir_icons(dir) {
        if old != icon_path {
            let _ = fs::remove_file(old);
        }
    }
    Ok(icon_path.display().to_string())
}

pub fn restore(dir: &Path) -> Result<bool, String> {
    let icons = dir_icons(dir);
    let changed = !icons.is_empty();
    set_icon(dir, None)?;
    for ico in icons {
        let _ = fs::remove_file(ico);
    }
    Ok(changed)
}

pub fn state(dir: &Path) -> Result<StateInfo, String> {
    let ico_exists = !dir_icons(dir).is_empty();
    Ok(StateInfo {
        customized: ico_exists,
        ico_exists,
        has_icon_resource: ico_exists,
    })
}
