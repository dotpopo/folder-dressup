#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod platform;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use platform::{assert_folder, imp, Sizes};

const ALLOWED_SIZES: [u32; 7] = [16, 24, 32, 48, 64, 128, 256];
const IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];
const PACK_MAX_FILES: usize = 60;
const IMAGE_MAX_BYTES: u64 = 10 * 1024 * 1024;

// ---------------- 皮肤包 ----------------

fn packs_root() -> PathBuf {
    let base = std::env::var("APPDATA")
        .or_else(|_| std::env::var("XDG_DATA_HOME"))
        .or_else(|_| std::env::var("HOME").map(|h| format!("{}/.local/share", h)))
        .unwrap_or_default();
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
        .filter(|e| {
            e.metadata()
                .map(|m| m.len() > 0 && m.len() <= IMAGE_MAX_BYTES)
                .unwrap_or(false)
        })
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

fn data_url(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|_| "图片不存在".to_string())?;
    if meta.len() > IMAGE_MAX_BYTES {
        return Err("图片超过 10MB".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    Ok(format!("data:{};base64,{}", mime_for(&ext), B64.encode(bytes)))
}

// ---------------- 命令 ----------------

#[derive(serde::Serialize)]
struct ApplyResult {
    ico_path: String,
    elapsed_ms: u128,
}

#[tauri::command]
fn apply_icon(folder: String, sizes: HashMap<String, String>) -> Result<ApplyResult, String> {
    let started = std::time::Instant::now();
    let dir = assert_folder(&folder)?;
    let mut decoded: Sizes = HashMap::new();
    for (k, v) in sizes.iter() {
        let size: u32 = k.parse().map_err(|_| "尺寸键非法".to_string())?;
        if !ALLOWED_SIZES.contains(&size) {
            continue;
        }
        let bytes = B64.decode(v).map_err(|_| "图标数据不是合法 base64".to_string())?;
        if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
            return Err("图标数据大小异常".into());
        }
        decoded.insert(size, bytes);
    }
    let ico_path = imp::apply(&dir, &decoded)?;
    Ok(ApplyResult {
        ico_path,
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
    Ok(RestoreResult {
        changed: imp::restore(&dir)?,
    })
}

#[tauri::command]
fn get_state(folder: String) -> Result<platform::StateInfo, String> {
    let dir = assert_folder(&folder)?;
    imp::state(&dir)
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
    data_url(&base.join(&file))
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
    Ok(DropResult {
        kind: "image".into(),
        path: path.clone(),
        data_url: Some(data_url(&p)?),
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
    let picked = app
        .dialog()
        .file()
        .add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"])
        .blocking_pick_file();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    Ok(Some(data_url(&path)?))
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
