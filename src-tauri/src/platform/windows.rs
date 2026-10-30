// Windows：desktop.ini（UTF-16LE）+ 隐藏 .ico + 文件属性 + SHChangeNotify

use std::collections::HashMap;
use std::ffi::c_void;
use std::fs;
use std::io::Cursor;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use windows_sys::Win32::Storage::FileSystem::{
    SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_SYSTEM,
};
use windows_sys::Win32::UI::Shell::SHChangeNotify;

use super::{dir_icons, short_hash, write_atomic, Sizes, StateInfo};

const INI_NAME: &str = "desktop.ini";
const ORDER: [u32; 7] = [256, 128, 64, 48, 32, 24, 16];

const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
const SHCNE_UPDATEDIR: i32 = 0x0000_1000;
const SHCNE_UPDATEITEM: i32 = 0x0000_2000;
const SHCNF_PATHW: u32 = 0x0005;

fn wide(s: &Path) -> Vec<u16> {
    s.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

fn set_attrs(path: &Path, attrs: u32) {
    unsafe {
        SetFileAttributesW(wide(path).as_ptr(), attrs);
    }
}

fn notify(event: i32, flags: u32, p: &Path) {
    let w = wide(p);
    unsafe {
        SHChangeNotify(event, flags, w.as_ptr() as *const c_void, std::ptr::null());
    }
}

/// 先精准（文件夹项/父目录），最后全局失效图标缓存
fn notify_shell(folder: &Path) {
    notify(SHCNE_UPDATEITEM, SHCNF_PATHW, folder);
    notify(SHCNE_UPDATEDIR, SHCNF_PATHW, folder);
    if let Some(parent) = folder.parent() {
        notify(SHCNE_UPDATEDIR, SHCNF_PATHW, parent);
    }
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, 0, std::ptr::null(), std::ptr::null());
    }
}

pub fn decode_ini(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe {
        let mut u16s = Vec::with_capacity((bytes.len() - 2) / 2);
        for chunk in bytes[2..].chunks_exact(2) {
            u16s.push(u16::from_le_bytes([chunk[0], chunk[1]]));
        }
        String::from_utf16_lossy(&u16s)
    } else if bytes.len() >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf {
        String::from_utf8_lossy(&bytes[3..]).to_string()
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

pub fn encode_ini(content: &str) -> Vec<u8> {
    let mut out = vec![0xff, 0xfe];
    for u in content.encode_utf16() {
        out.extend_from_slice(&u.to_le_bytes());
    }
    out
}

pub fn upsert_icon_resource(content: &str, ico: &Path) -> String {
    let line = format!("IconResource={},0", ico.display());
    let mut lines: Vec<String> = if content.is_empty() {
        Vec::new()
    } else {
        content.split("\r\n").map(|s| s.to_string()).collect()
    };
    let section = lines
        .iter()
        .position(|l| l.trim().eq_ignore_ascii_case("[.ShellClassInfo]"));
    let Some(idx) = section else {
        let mut out: Vec<String> = lines.into_iter().filter(|l| !l.trim().is_empty()).collect();
        if !out.is_empty() {
            out.push(String::new());
        }
        out.push("[.ShellClassInfo]".into());
        out.push(line);
        out.push(String::new());
        return out.join("\r\n");
    };
    let mut end = lines.len();
    for (i, l) in lines.iter().enumerate().skip(idx + 1) {
        let t = l.trim();
        if t.starts_with('[') && t.ends_with(']') {
            end = i;
            break;
        }
    }
    let mut replaced = false;
    for l in lines.iter_mut().take(end).skip(idx + 1) {
        if l.trim_start().to_ascii_lowercase().starts_with("iconresource") {
            *l = line.clone();
            replaced = true;
            break;
        }
    }
    if !replaced {
        lines.insert(end, line);
    }
    lines.join("\r\n")
}

pub fn remove_icon_resource(content: &str) -> (String, bool) {
    let mut removed = false;
    let kept: Vec<&str> = content
        .split("\r\n")
        .filter(|l| {
            if l.trim_start().to_ascii_lowercase().starts_with("iconresource") {
                removed = true;
                false
            } else {
                true
            }
        })
        .collect();
    let mut out = kept.join("\r\n");
    if removed {
        let only_section = out
            .lines()
            .filter(|l| !l.trim().is_empty())
            .all(|l| l.trim().eq_ignore_ascii_case("[.ShellClassInfo]"));
        if only_section {
            out = String::new();
        }
    }
    (out, removed)
}

fn decode_rgba(png: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let dec = png::Decoder::new(Cursor::new(png));
    let mut reader = dec.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    let (w, h) = (info.width, info.height);
    let data = &buf[..info.buffer_size()];
    let px = match (info.color_type, info.bit_depth) {
        (png::ColorType::Rgba, png::BitDepth::Eight) => data.to_vec(),
        (png::ColorType::Rgb, png::BitDepth::Eight) => {
            let mut out = Vec::with_capacity((w * h * 4) as usize);
            for c in data.chunks_exact(3) {
                out.extend_from_slice(&[c[0], c[1], c[2], 255]);
            }
            out
        }
        (png::ColorType::GrayscaleAlpha, png::BitDepth::Eight) => {
            let mut out = Vec::with_capacity((w * h * 4) as usize);
            for c in data.chunks_exact(2) {
                out.extend_from_slice(&[c[0], c[0], c[0], c[1]]);
            }
            out
        }
        (png::ColorType::Grayscale, png::BitDepth::Eight) => {
            let mut out = Vec::with_capacity((w * h * 4) as usize);
            for &g in data {
                out.extend_from_slice(&[g, g, g, 255]);
            }
            out
        }
        _ => return Err("不支持的 PNG 形态".into()),
    };
    Ok((w, h, px))
}

fn dib_from_rgba(rgba: &[u8], w: u32, h: u32) -> Vec<u8> {
    let xor_size = (w * h * 4) as usize;
    let and_row = ((w + 31) / 32 * 4) as usize;
    let and_size = and_row * h as usize;
    let mut out = vec![0u8; 40 + xor_size + and_size];
    out[0..4].copy_from_slice(&40u32.to_le_bytes());
    out[4..8].copy_from_slice(&(w as i32).to_le_bytes());
    out[8..12].copy_from_slice(&((h as i32) * 2).to_le_bytes());
    out[12..14].copy_from_slice(&1u16.to_le_bytes());
    out[14..16].copy_from_slice(&32u16.to_le_bytes());
    out[20..24].copy_from_slice(&((xor_size + and_size) as u32).to_le_bytes());
    for y in 0..h {
        let dst_row = h - 1 - y;
        for x in 0..w {
            let s = ((y * w + x) * 4) as usize;
            let d = 40 + ((dst_row * w + x) * 4) as usize;
            out[d] = rgba[s + 2];
            out[d + 1] = rgba[s + 1];
            out[d + 2] = rgba[s];
            out[d + 3] = rgba[s + 3];
        }
    }
    out
}

fn png_size(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() < 24 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("不是有效的 PNG".into());
    }
    let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Ok((w, h))
}

pub fn build_ico(sizes: &HashMap<u32, Vec<u8>>) -> Result<Vec<u8>, String> {
    let mut images: Vec<(u32, Vec<u8>)> = Vec::new();
    for &s in ORDER.iter() {
        let Some(png) = sizes.get(&s) else { continue };
        let (w, h) = png_size(png)?;
        if w != s || h != s {
            return Err(format!("尺寸 {} 的 PNG 实际为 {}x{}", s, w, h));
        }
        let data = if s < 256 {
            match decode_rgba(png) {
                Ok((w, h, rgba)) => dib_from_rgba(&rgba, w, h),
                Err(_) => png.clone(),
            }
        } else {
            png.clone()
        };
        images.push((s, data));
    }
    if images.is_empty() {
        return Err("缺少图标尺寸数据".into());
    }
    if !images.iter().any(|(s, _)| *s == 256) {
        return Err("缺少 256px 主尺寸".into());
    }

    let mut out = Vec::new();
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&(images.len() as u16).to_le_bytes());
    let mut offset = 6 + images.len() * 16;
    for (size, data) in images.iter() {
        let b = if *size >= 256 { 0u8 } else { *size as u8 };
        out.push(b);
        out.push(b);
        out.push(0);
        out.push(0);
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&32u16.to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(offset as u32).to_le_bytes());
        offset += data.len();
    }
    for (_, data) in images.iter() {
        out.extend_from_slice(data);
    }
    Ok(out)
}

pub fn apply(dir: &Path, sizes: &Sizes) -> Result<String, String> {
    let ico = build_ico(sizes)?;
    let ico_path = dir.join(format!("{}-{}.ico", super::ICON_PREFIX, short_hash(&ico)));
    let ini_path = dir.join(INI_NAME);

    // 1) 先写新图标（旧图标仍在，任何时刻都不存在悬空引用）
    write_atomic(&ico_path, &ico)?;

    // 2) desktop.ini 指向新图标
    let existing = fs::read(&ini_path).map(|b| decode_ini(&b)).unwrap_or_default();
    if existing.contains('\u{FFFD}') {
        return Err("该文件夹的 desktop.ini 使用了旧编码格式，为避免破坏其中内容未做修改。".into());
    }
    let next = upsert_icon_resource(&existing, &ico_path);
    write_atomic(&ini_path, &encode_ini(&next))?;

    // 3) 属性 + 通知
    set_attrs(&ini_path, FILE_ATTRIBUTE_SYSTEM | FILE_ATTRIBUTE_HIDDEN);
    set_attrs(&ico_path, FILE_ATTRIBUTE_HIDDEN);
    set_attrs(dir, FILE_ATTRIBUTE_SYSTEM);
    notify_shell(dir);

    // 4) 清理旧图标
    for old in dir_icons(dir) {
        if old != ico_path {
            let _ = fs::remove_file(old);
        }
    }

    Ok(ico_path.display().to_string())
}

pub fn restore(dir: &Path) -> Result<bool, String> {
    let ini_path = dir.join(INI_NAME);
    let mut changed = false;

    if let Ok(bytes) = fs::read(&ini_path) {
        let content = decode_ini(&bytes);
        if !content.contains('\u{FFFD}') {
            let (next, removed) = remove_icon_resource(&content);
            if removed {
                changed = true;
                if next.trim().is_empty() {
                    let _ = fs::remove_file(&ini_path);
                } else {
                    write_atomic(&ini_path, &encode_ini(&next))?;
                }
            }
        }
    }

    let icons: Vec<PathBuf> = dir_icons(dir);
    if !icons.is_empty() {
        changed = true;
        for ico in icons {
            let _ = fs::remove_file(ico);
        }
    }

    set_attrs(dir, FILE_ATTRIBUTE_NORMAL);
    notify_shell(dir);
    Ok(changed)
}

pub fn state(dir: &Path) -> Result<StateInfo, String> {
    let ico_exists = !dir_icons(dir).is_empty();
    let has_icon_resource = fs::read(dir.join(INI_NAME))
        .map(|b| {
            decode_ini(&b)
                .lines()
                .any(|l| l.trim_start().to_ascii_lowercase().starts_with("iconresource"))
        })
        .unwrap_or(false);
    Ok(StateInfo {
        customized: ico_exists || has_icon_resource,
        ico_exists,
        has_icon_resource,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_png(size: u32) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, size, size);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut writer = enc.write_header().unwrap();
            let mut data = vec![0u8; (size * size * 4) as usize];
            for px in data.chunks_exact_mut(4) {
                px.copy_from_slice(&[40, 120, 240, 255]);
            }
            writer.write_image_data(&data).unwrap();
        }
        out
    }

    fn sizes_map() -> HashMap<u32, Vec<u8>> {
        ORDER.iter().map(|&s| (s, make_png(s))).collect()
    }

    #[test]
    fn ico_has_all_entries() {
        let ico = build_ico(&sizes_map()).unwrap();
        assert_eq!(&ico[0..4], &[0, 0, 1, 0]);
        assert_eq!(u16::from_le_bytes([ico[4], ico[5]]), 7);
        let first = u32::from_le_bytes([ico[18], ico[19], ico[20], ico[21]]) as usize;
        assert_eq!(&ico[first..first + 8], b"\x89PNG\r\n\x1a\n");
        let second = 6 + 16;
        let off = u32::from_le_bytes([ico[second + 12], ico[second + 13], ico[second + 14], ico[second + 15]]) as usize;
        assert_eq!(u32::from_le_bytes([ico[off], ico[off + 1], ico[off + 2], ico[off + 3]]), 40);
    }

    #[test]
    fn ini_upsert_is_idempotent_and_removable() {
        let ico = Path::new(r"C:\x\.diricon-abc.ico");
        let once = upsert_icon_resource("", ico);
        assert!(once.contains("[.ShellClassInfo]"));
        assert_eq!(upsert_icon_resource(&once, ico), once);
        let (removed, hit) = remove_icon_resource(&once);
        assert!(hit);
        assert!(removed.trim().is_empty());
    }

    #[test]
    fn ini_keeps_other_content() {
        let ico = Path::new(r"D:\y\.diricon-def.ico");
        let base = "[.ShellClassInfo]\r\nConfirmFileOp=0\r\n\r\n[ViewMode]\r\nMode=2";
        let next = upsert_icon_resource(base, ico);
        assert!(next.contains("ConfirmFileOp=0"));
        assert!(next.contains("Mode=2"));
        assert_eq!(next.matches("IconResource=").count(), 1);
        let (after, _) = remove_icon_resource(&next);
        assert!(after.contains("ConfirmFileOp=0"));
        assert!(!after.contains("IconResource"));
    }

    #[test]
    fn utf16_roundtrip_with_chinese_path() {
        let text = concat!("[.ShellClassInfo]\r\nIconResource=C:\\中文\\路径\\.diricon-x.ico,0");
        assert_eq!(decode_ini(&encode_ini(text)), text);
    }

    #[test]
    fn apply_then_restore_on_temp_folder() {
        let dir = std::env::temp_dir().join(format!("fd-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let res = apply(&dir, &sizes_map()).unwrap();
        assert!(Path::new(&res).is_file());
        assert!(dir.join(INI_NAME).is_file());
        let ico_name = Path::new(&res).file_name().unwrap().to_str().unwrap().to_string();
        assert!(ico_name.starts_with(super::super::ICON_PREFIX));

        let st = state(&dir).unwrap();
        assert!(st.customized && st.ico_exists && st.has_icon_resource);

        let mut sizes2 = sizes_map();
        let mut png = make_png(256);
        png[100] ^= 0xff;
        sizes2.insert(256, png);
        let res2 = apply(&dir, &sizes2).unwrap();
        assert_ne!(res, res2);
        assert!(!Path::new(&res).exists());
        assert_eq!(dir_icons(&dir).len(), 1);

        let r = restore(&dir).unwrap();
        assert!(r);
        assert!(dir_icons(&dir).is_empty());
        assert!(!dir.join(INI_NAME).exists());
        assert!(!state(&dir).unwrap().customized);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_missing_256() {
        let mut bad = sizes_map();
        bad.remove(&256);
        assert!(build_ico(&bad).is_err());
    }
}
