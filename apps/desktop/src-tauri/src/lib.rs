use std::{
    ffi::OsStr,
    env, fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use sha2::{Digest, Sha256};
use tauri::Emitter;

#[derive(Clone, serde::Serialize)]
struct OpenFilePayload {
    path: String,
}
static PENDING_OPEN_PATH: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn pending_open_path() -> &'static Mutex<Option<String>> {
    PENDING_OPEN_PATH.get_or_init(|| Mutex::new(None))
}

fn set_pending_open_path(path: String) {
    if let Ok(mut guard) = pending_open_path().lock() {
        *guard = Some(path);
    }
}

fn take_pending_open_path() -> Option<String> {
    pending_open_path().lock().ok().and_then(|mut guard| guard.take())
}
fn path_to_os_string(path: &Path) -> String {
    path.as_os_str().to_string_lossy().into_owned()
}
fn path_to_markdown_link(path: &Path) -> String {
    path.as_os_str().to_string_lossy().replace('\\', "/")
}

fn first_existing_file_arg_from_iter<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    args.into_iter().find_map(|arg| {
        let path = PathBuf::from(arg.as_ref());
        if path.is_file() {
            Some(path_to_os_string(&path))
        } else {
            None
        }
    })
}

#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|err| format!("Failed to read file at {}: {}", path, err))
}
#[tauri::command]
fn write_file_text(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|err| format!("Failed to write file at {}: {}", path, err))
}

#[derive(serde::Serialize)]
struct PersistPastedImageOutput {
    relative_markdown_path: String,
    deduped: bool,
}

fn extension_from_image(bytes: &[u8], mime_type: Option<&str>) -> &'static str {
    if let Some(mime) = mime_type {
        let mime = mime.trim().to_ascii_lowercase();
        if mime.contains("png") {
            return "png";
        }
        if mime.contains("jpeg") || mime.contains("jpg") {
            return "jpg";
        }
        if mime.contains("webp") {
            return "webp";
        }
        if mime.contains("gif") {
            return "gif";
        }
        if mime.contains("bmp") {
            return "bmp";
        }
        if mime.contains("svg") {
            return "svg";
        }
    }

    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return "png";
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return "jpg";
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return "gif";
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "webp";
    }
    if bytes.starts_with(b"BM") {
        return "bmp";
    }
    "png"
}

fn note_assets_dir(note_path: &Path) -> Result<PathBuf, String> {
    let note_parent = note_path
        .parent()
        .ok_or_else(|| format!("Unable to resolve parent folder for note: {}", note_path.display()))?;
    let note_stem = note_path
        .file_stem()
        .ok_or_else(|| format!("Unable to resolve note filename for path: {}", note_path.display()))?
        .to_string_lossy();
    Ok(note_parent.join(format!("{}.assets", note_stem)))
}

#[tauri::command]
fn persist_pasted_image(
    note_path: String,
    bytes: Vec<u8>,
    mime_type: Option<String>,
) -> Result<PersistPastedImageOutput, String> {
    if bytes.is_empty() {
        return Err("Clipboard image bytes are empty".to_string());
    }

    let note_path = PathBuf::from(&note_path);
    let note_parent = note_path
        .parent()
        .ok_or_else(|| format!("Unable to resolve parent folder for note: {}", note_path.display()))?;
    let assets_dir = note_assets_dir(&note_path)?;
    fs::create_dir_all(&assets_dir).map_err(|err| {
        format!(
            "Failed to create attachment directory at {}: {}",
            assets_dir.display(),
            err
        )
    })?;

    let hash = format!("{:x}", Sha256::digest(&bytes));
    let short_hash = &hash[..12];
    let ext = extension_from_image(&bytes, mime_type.as_deref());
    let mut image_path = assets_dir.join(format!("{}.{}", short_hash, ext));
    let mut deduped = false;

    if image_path.exists() {
        let existing = fs::read(&image_path).map_err(|err| {
            format!(
                "Failed to read existing image at {}: {}",
                image_path.display(),
                err
            )
        })?;
        if existing == bytes {
            deduped = true;
        } else {
            image_path = assets_dir.join(format!("{}.{}", hash, ext));
            if image_path.exists() {
                let existing_full = fs::read(&image_path).map_err(|err| {
                    format!(
                        "Failed to read existing image at {}: {}",
                        image_path.display(),
                        err
                    )
                })?;
                if existing_full == bytes {
                    deduped = true;
                } else {
                    return Err(format!(
                        "Hash collision while saving image at {}",
                        image_path.display()
                    ));
                }
            }
        }
    }

    if !deduped && !image_path.exists() {
        fs::write(&image_path, bytes).map_err(|err| {
            format!("Failed to write image at {}: {}", image_path.display(), err)
        })?;
    }

    let relative_image_path = image_path
        .strip_prefix(note_parent)
        .map_err(|err| {
            format!(
                "Failed to compute relative image path from {} to {}: {}",
                note_parent.display(),
                image_path.display(),
                err
            )
        })?;

    Ok(PersistPastedImageOutput {
        relative_markdown_path: path_to_markdown_link(relative_image_path),
        deduped,
    })
}

#[tauri::command]
fn get_launch_file_path() -> Option<String> {
    let arg_path = first_existing_file_arg_from_iter(env::args_os().skip(1));
    arg_path.or_else(take_pending_open_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = first_existing_file_arg_from_iter(args.iter().skip(1)) {
                set_pending_open_path(path.clone());
                let _ = app.emit("hubble://open-file", OpenFilePayload { path });
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_file_text,
            write_file_text,
            persist_pasted_image,
            get_launch_file_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path_string = path_to_os_string(&path);
                    set_pending_open_path(path_string.clone());
                    let _ = app_handle.emit(
                        "hubble://open-file",
                        OpenFilePayload { path: path_string },
                    );
                    break;
                }
            }
        }
    });
}
