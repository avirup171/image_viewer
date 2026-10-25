//! Opening folders and listing the images in them.

use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

pub const EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp"];

pub fn has_image_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

#[derive(Debug, Serialize, Clone)]
pub struct ImageEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Last modified, in milliseconds since 1970. The frontend also uses
    /// it (with `size`) to bust caches after an edit replaces a file.
    pub modified: u64,
}

#[derive(Serialize)]
pub struct Folder {
    /// Absolute path of the folder.
    dir: String,
    /// Just the folder's own name, for the breadcrumb.
    name: String,
    /// Name of the parent folder, if any.
    parent_name: Option<String>,
    images: Vec<ImageEntry>,
    /// When the user opened a single file, the path of that file so the
    /// frontend can select it.
    selected: Option<String>,
}

fn entry_from(path: &Path, meta: &fs::Metadata) -> ImageEntry {
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    ImageEntry {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        size: meta.len(),
        modified,
    }
}

/// The entry for a single file, e.g. one an edit just wrote.
pub fn entry_for(path: &Path) -> AppResult<ImageEntry> {
    Ok(entry_from(path, &fs::metadata(path)?))
}

fn scan(dir: &Path) -> AppResult<Vec<ImageEntry>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        // One unreadable entry shouldn't fail the whole folder: skip it.
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if !has_image_ext(&path) {
            continue; // cheap check first, before asking the OS for metadata
        }
        // fs::metadata follows symlinks (DirEntry::metadata does not on Unix)
        let Ok(meta) = fs::metadata(&path) else { continue };
        if !meta.is_file() {
            continue;
        }
        out.push(entry_from(&path, &meta));
    }
    // The frontend re-sorts by the user's choice; name order is a sane default.
    out.sort_by_cached_key(|e| e.name.to_lowercase());
    Ok(out)
}

/// Open a folder, or an image file (which opens its folder with that image
/// selected). Used by the folder dialog, "Open images…", recent folders and
/// drag-and-drop.
#[tauri::command]
pub async fn open_path(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<Folder> {
    let path = PathBuf::from(path);
    let meta = fs::metadata(&path)?;

    let (dir, selected) = if meta.is_dir() {
        (path, None)
    } else if has_image_ext(&path) {
        let parent = path
            .parent()
            .ok_or_else(|| AppError::Other("File has no parent folder".into()))?
            .to_path_buf();
        (parent, Some(path.to_string_lossy().into_owned()))
    } else {
        return Err(AppError::Other("That isn't an image or a folder".into()));
    };

    // Grant access for this folder: Tauri's asset protocol (full-size images)
    // and our own thumb:// protocol + commands (AppState).
    app.asset_protocol_scope()
        .allow_directory(&dir, false)
        .map_err(|e| AppError::Other(e.to_string()))?;
    state.allow_dir(&dir);

    let scan_dir = dir.clone();
    let images = tauri::async_runtime::spawn_blocking(move || scan(&scan_dir))
        .await
        .map_err(|e| AppError::Other(e.to_string()))??;

    let name_of = |p: &Path| p.file_name().map(|n| n.to_string_lossy().into_owned());
    Ok(Folder {
        name: name_of(&dir).unwrap_or_else(|| dir.to_string_lossy().into_owned()),
        parent_name: dir.parent().and_then(name_of),
        dir: dir.to_string_lossy().into_owned(),
        images,
        selected,
    })
}

/// Move an image to the OS Trash. The frontend only calls this once the
/// "Undo" toast has expired, so undo never needs to restore from the Trash.
#[tauri::command]
pub async fn trash_image(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    if !state.is_allowed(&path) || !has_image_ext(&path) {
        return Err(AppError::Forbidden(path.to_string_lossy().into_owned()));
    }
    tauri::async_runtime::spawn_blocking(move || trash::delete(&path))
        .await
        .map_err(|e| AppError::Other(e.to_string()))??;
    Ok(())
}
