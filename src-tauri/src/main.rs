#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::ffi::c_void;
use std::fs;
use std::io::Cursor;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use sha1::{Digest, Sha1};
use windows_sys::Win32::Storage::FileSystem::{
    SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_SYSTEM,
};
use windows_sys::Win32::UI::Shell::SHChangeNotify;

const ICON_PREFIX: &str = ".diricon";
const INI_NAME: &str = "desktop.ini";
const IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];
const ORDER: [u32; 7] = [256, 128, 64, 48, 32, 24, 16];
const PACK_MAX_FILES: usize = 60;
const IMAGE_MAX_BYTES: u64 = 10 * 1024 * 1024;

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

/// 通知资源管理器：先精准（文件夹项/父目录），最后全局失效图标缓存
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

// ---------------- desktop.ini ----------------

fn decode_ini(bytes: &[u8]) -> String {
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

fn encode_ini(content: &str) -> Vec<u8> {
    let mut out = vec![0xff, 0xfe];
    for u in content.encode_utf16() {
        out.extend_from_slice(&u.to_le_bytes());
    }
    out
}

fn upsert_icon_resource(content: &str, ico: &Path) -> String {
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

fn remove_icon_resource(content: &str) -> (String, bool) {
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

// ---------------- ICO ----------------

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

fn build_ico(sizes: &HashMap<u32, Vec<u8>>) -> Result<Vec<u8>, String> {
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

// ---------------- 应用 / 还原 ----------------

fn ico_name_for(bytes: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let hex: String = digest.iter().take(5).map(|b| format!("{:02x}", b)).collect();
    format!("{}-{}.ico", ICON_PREFIX, hex)
}

fn dir_icons(folder: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(ICON_PREFIX) && n.ends_with(".ico"))
                .unwrap_or(false)
        })
        .collect()
}

fn assert_folder(folder: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(folder);
    if !p.is_absolute() {
        return Err("请提供文件夹的绝对路径".into());
    }
    if !p.is_dir() {
        return Err(format!("文件夹不存在：{}", folder));
    }
    Ok(p)
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!(
        "{}tmp",
        path.extension().and_then(|e| e.to_str()).map(|e| format!("{}.", e)).unwrap_or_default()
    ));
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).or_else(|_| {
        let _ = fs::remove_file(path);
        fs::rename(&tmp, path)
    }).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct ApplyResult {
    ico_path: String,
    elapsed_ms: u128,
}

#[tauri::command]
fn apply_icon(folder: String, sizes: HashMap<String, String>) -> Result<ApplyResult, String> {
    let started = std::time::Instant::now();
    let dir = assert_folder(&folder)?;
    let mut decoded: HashMap<u32, Vec<u8>> = HashMap::new();
    for (k, v) in sizes.iter() {
        let size: u32 = k.parse().map_err(|_| "尺寸键非法".to_string())?;
        if !ORDER.contains(&size) {
            continue;
        }
        let bytes = B64.decode(v).map_err(|_| "图标数据不是合法 base64".to_string())?;
        if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
            return Err("图标数据大小异常".into());
        }
        decoded.insert(size, bytes);
    }
    let ico = build_ico(&decoded)?;
    let ico_name = ico_name_for(&ico);
    let ico_path = dir.join(&ico_name);
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

    // 3) 属性 + 通知（原生调用，毫秒级）
    set_attrs(&ini_path, FILE_ATTRIBUTE_SYSTEM | FILE_ATTRIBUTE_HIDDEN);
    set_attrs(&ico_path, FILE_ATTRIBUTE_HIDDEN);
    set_attrs(&dir, FILE_ATTRIBUTE_SYSTEM);
    notify_shell(&dir);

    // 4) 清理旧图标
    for old in dir_icons(&dir) {
        if old != ico_path {
            let _ = fs::remove_file(old);
        }
    }

    Ok(ApplyResult {
        ico_path: ico_path.display().to_string(),
        elapsed_ms: started.elapsed().as_millis(),
    })
}

#[derive(serde::Serialize)]
struct RestoreResult {
    changed: bool,
}

#[tauri::command]
fn restore_icon(folder: String) -> Result<RestoreResult, String> {
    let dir = assert_folder(&folder)?;
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

    let icons = dir_icons(&dir);
    if !icons.is_empty() {
        changed = true;
        for ico in icons {
            let _ = fs::remove_file(ico);
        }
    }

    set_attrs(&dir, FILE_ATTRIBUTE_NORMAL);
    notify_shell(&dir);
    Ok(RestoreResult { changed })
}

#[derive(serde::Serialize)]
struct StateResult {
    customized: bool,
    ico_exists: bool,
    has_icon_resource: bool,
}

#[tauri::command]
fn get_state(folder: String) -> Result<StateResult, String> {
    let dir = assert_folder(&folder)?;
    let ico_exists = !dir_icons(&dir).is_empty();
    let has_icon_resource = fs::read(dir.join(INI_NAME))
        .map(|b| {
            decode_ini(&b)
                .lines()
                .any(|l| l.trim_start().to_ascii_lowercase().starts_with("iconresource"))
        })
        .unwrap_or(false);
    Ok(StateResult {
        customized: ico_exists || has_icon_resource,
        ico_exists,
        has_icon_resource,
    })
}

// ---------------- 皮肤包 ----------------

fn packs_root() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_default();
    PathBuf::from(base).join("文件夹换装").join("packs")
}

fn is_image(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn scan_pack(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file() && is_image(&e.path()))
        .filter(|e| e.metadata().map(|m| m.len() > 0 && m.len() <= IMAGE_MAX_BYTES).unwrap_or(false))
        .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
        .collect();
    files.sort();
    files.truncate(PACK_MAX_FILES);
    files
}

#[derive(serde::Serialize)]
struct PackInfo {
    name: String,
    dir: String,
    count: usize,
}

#[tauri::command]
fn packs_list() -> Vec<PackInfo> {
    let root = packs_root();
    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for e in entries.filter_map(|e| e.ok()) {
        let dir = e.path();
        if !dir.is_dir() {
            continue;
        }
        let files = scan_pack(&dir);
        if files.is_empty() {
            continue;
        }
        out.push(PackInfo {
            name: dir.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
            dir: dir.display().to_string(),
            count: files.len(),
        });
    }
    out
}

#[tauri::command]
fn pack_files(dir: String) -> Result<Vec<String>, String> {
    let p = PathBuf::from(&dir);
    if !p.is_absolute() || !p.is_dir() {
        return Err("皮肤包路径无效".into());
    }
    Ok(scan_pack(&p))
}

fn mime_for(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "image/png",
    }
}

#[tauri::command]
fn pack_image(dir: String, file: String) -> Result<String, String> {
    let base = PathBuf::from(&dir);
    if !base.is_absolute() {
        return Err("皮肤包路径无效".into());
    }
    let name = Path::new(&file);
    if name.file_name().and_then(|n| n.to_str()) != Some(file.as_str()) || !is_image(name) {
        return Err("不是有效的图片文件".into());
    }
    let full = base.join(&file);
    let meta = fs::metadata(&full).map_err(|_| "图片不存在".to_string())?;
    if meta.len() > IMAGE_MAX_BYTES {
        return Err("图片超过 10MB".into());
    }
    let bytes = fs::read(&full).map_err(|e| e.to_string())?;
    let ext = full
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    Ok(format!("data:{};base64,{}", mime_for(&ext), B64.encode(bytes)))
}

#[derive(serde::Serialize)]
struct DropResult {
    #[serde(rename = "type")]
    kind: String,
    path: String,
    #[serde(rename = "dataUrl", skip_serializing_if = "Option::is_none")]
    data_url: Option<String>,
}

#[tauri::command]
fn ingest_drop(path: String) -> Result<DropResult, String> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        return Ok(DropResult {
            kind: "folder".into(),
            path,
            data_url: None,
        });
    }
    if !p.is_file() || !is_image(&p) {
        return Err("请拖入文件夹或图片".into());
    }
    let meta = fs::metadata(&p).map_err(|_| "路径不存在".to_string())?;
    if meta.len() > IMAGE_MAX_BYTES {
        return Err("图片超过 10MB".into());
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    Ok(DropResult {
        kind: "image".into(),
        path,
        data_url: Some(format!("data:{};base64,{}", mime_for(&ext), B64.encode(bytes))),
    })
}

#[tauri::command]
fn add_pack_folder(app: tauri::AppHandle) -> Result<Option<PackInfo>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().blocking_pick_folder();
    let Some(fp) = picked else { return Ok(None) };
    let dir = fp.into_path().map_err(|e| e.to_string())?;
    let files = scan_pack(&dir);
    if files.is_empty() {
        return Err("该文件夹里没有可用的图片".into());
    }
    Ok(Some(PackInfo {
        name: dir.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
        dir: dir.display().to_string(),
        count: files.len(),
    }))
}

#[tauri::command]
fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().blocking_pick_folder();
    match picked {
        None => Ok(None),
        Some(fp) => Ok(fp.into_path().ok().map(|p| p.display().to_string())),
    }
}

#[tauri::command]
fn pick_image(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file()
        .add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"])
        .blocking_pick_file();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > IMAGE_MAX_BYTES {
        return Err("图片超过 10MB".into());
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    Ok(Some(format!("data:{};base64,{}", mime_for(&ext), B64.encode(bytes))))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            apply_icon,
            restore_icon,
            get_state,
            packs_list,
            pack_files,
            pack_image,
            ingest_drop,
            add_pack_folder,
            pick_folder,
            pick_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
        // 256 条目为 PNG，小尺寸为 DIB（BITMAPINFOHEADER 长度 40）
        let entries = 7usize;
        let first_data = u32::from_le_bytes([ico[6 + 12], ico[6 + 13], ico[6 + 14], ico[6 + 15]]) as usize;
        assert_eq!(&ico[first_data..first_data + 8], b"\x89PNG\r\n\x1a\n");
        let second = 6 + 16;
        let off = u32::from_le_bytes([ico[second + 12], ico[second + 13], ico[second + 14], ico[second + 15]]) as usize;
        assert_eq!(u32::from_le_bytes([ico[off], ico[off + 1], ico[off + 2], ico[off + 3]]), 40);
        assert!(entries == 7);
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
        let text = concat!(
            "[.ShellClassInfo]\r\nIconResource=C:\\中文\\路径\\.diricon-x.ico,0"
        );
        assert_eq!(decode_ini(&encode_ini(text)), text);
    }

    #[test]
    fn apply_then_restore_on_temp_folder() {
        let dir = std::env::temp_dir().join(format!("fd-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let folder = dir.display().to_string();

        let sizes: HashMap<String, String> = sizes_map()
            .into_iter()
            .map(|(k, v)| (k.to_string(), B64.encode(v)))
            .collect();
        let res = apply_icon(folder.clone(), sizes.clone()).unwrap();
        assert!(Path::new(&res.ico_path).is_file());
        assert!(dir.join(INI_NAME).is_file());
        let ico_name = Path::new(&res.ico_path).file_name().unwrap().to_str().unwrap().to_string();
        assert!(ico_name.starts_with(ICON_PREFIX));

        let st = get_state(folder.clone()).unwrap();
        assert!(st.customized && st.ico_exists && st.has_icon_resource);

        // 二次应用（内容不同）应换新文件名并清理旧文件
        let mut sizes2 = sizes.clone();
        let mut png = make_png(256);
        png[100] ^= 0xff;
        sizes2.insert("256".into(), B64.encode(png));
        let res2 = apply_icon(folder.clone(), sizes2).unwrap();
        assert_ne!(res.ico_path, res2.ico_path);
        assert!(!Path::new(&res.ico_path).exists());
        assert_eq!(dir_icons(&dir).len(), 1);

        let r = restore_icon(folder).unwrap();
        assert!(r.changed);
        assert!(dir_icons(&dir).is_empty());
        assert!(!dir.join(INI_NAME).exists());
        let st2 = get_state(dir.display().to_string()).unwrap();
        assert!(!st2.customized);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_bad_input() {
        let mut bad = sizes_map();
        bad.remove(&256);
        assert!(build_ico(&bad).is_err());
        assert!(apply_icon("relative\\path".into(), HashMap::new()).is_err());
    }
}
