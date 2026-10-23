mod error;
mod info;
mod library;
mod state;
mod thumbs;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Remembers window size/position between launches (Rust-only, no JS).
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        // Used by the info panel's "Reveal in Finder".
        .plugin(tauri_plugin_opener::init())
        // Shared state: which folders are allowed + the thumbnail semaphore.
        .manage(AppState::new())
        // thumb://<encoded path> -> resized, cached preview (see thumbs.rs)
        .register_asynchronous_uri_scheme_protocol("thumb", thumbs::handle)
        .invoke_handler(tauri::generate_handler![
            library::open_path,
            library::trash_image,
            info::image_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
