# CLAUDE.md

Context for Claude when working on this repository.

## Project

**Spektro Photo** (called Image Viewer until 0.1.2): a small, fast desktop image viewer for macOS
(Apple Silicon) and Windows. Personal learning / side project by Avirup Basu (GitHub:
`avirup171/spektro-photo`, MIT; the old `image_viewer` URL redirects).
The owner is an experienced Rust developer who is newer to Tauri and frontend work:
explain *why* when changing things, and keep the app simple. It's a viewer with basic
editing, not a photo editor.

- Stack: **Tauri 2** (Rust backend) + **React 19 + TypeScript + Vite** frontend, plain CSS.
- Current version: **0.1.2** (Nov 2026: Adjust tool, i.e. temperature, brightness, contrast, saturation).
  Tags: `v0.1.0`, `v0.1.1` (crop), `v0.1.2` (adjust; tagged on `main` and pushed 2026-11-01).
- Roadmap: rotate / flip, resize, live folder watching (`notify`), persisting folder access
  across restarts, Windows code signing, camera RAW (ImageIO on macOS could do it, like HEIC).
- Unreleased on `dev`: HEIC / HEIF support on macOS (see "HEIC (macOS only)" below).
- Ideas not yet scheduled: hold-to-compare (show the original) in the editor; an Adjust
  screenshot for the README (`docs/screenshot-adjust.jpg`).

## Commands

```bash
npm ci                      # install frontend deps
npm run tauri dev           # run the app (Vite on :1420 + Rust)
cargo tauri dev             # same, via cargo (needs: cargo install tauri-cli --version "^2" --locked)
npx tsc                     # type-check; run before any release build
(cd src-tauri && cargo test)    # Rust unit tests (edit pipeline, EXIF, saving)
(cd src-tauri && cargo clippy --lib --tests)
npm run tauri build         # release build → src-tauri/target/release/bundle/{macos,dmg}
```

Plain `cargo run` (in `src-tauri`) also works, but a debug build loads the frontend from
`devUrl`, so `npm run dev` must be running in another terminal first.

`npm run build` is `tsc && vite build`, and `tsconfig.json` has `noUnusedLocals: true`,
so **an unused import fails the release build** (but not `tauri dev`). Editors' auto-import
has caused this before.

## Layout

```
src/
  App.tsx                 app state machine: view = "grid" | "viewer" | "edit"; global keyboard; open / trash / edit flows
  App.css                 all styles; CSS variables at the top (dark theme, accent #5B9BFF)
  components/             Welcome, Library (grid), Viewer, InfoPanel, Overlays (toast, shortcuts), Icons
  lib/api.ts              ALL invoke() calls + types mirroring Rust; fullSrc/thumbSrc URL builders
  lib/storage.ts          localStorage prefs (try/catch-wrapped)
  lib/useImageInfo.ts     dimensions + EXIF hook (debounced, versioned)
  edit/                   editor (generic) + tools
    EditMode.tsx          editor shell: renders registered tools, collects ops, Save as copy / Replace
    tool.ts               EditTool<S> interface + defineTool()
    types.ts              EditOp union, SaveMode, EditResult, canEdit()
    tools/index.ts        tool registry (order = toolbar order = op order)
    colorMatrix.ts        3×4 colour matrices: compose, toSvgValues (mirrors edit/color.rs)
    tools/crop/           cropState.ts, cropMath.ts (pure geometry), CropOverlay.tsx, CropControls.tsx, index.tsx
    tools/adjust/         adjustments.ts (slider list + formulas, mirrors edit/adjust.rs), AdjustPanel.tsx, index.tsx
src-tauri/src/
  lib.rs                  Builder: plugins, AppState, thumb:// protocol, invoke_handler list
  library.rs              open_path, trash_image, folder scan, ImageEntry, entry_for()
  thumbs.rs               thumb:// (560px) and preview:// (full-size JPEG, for HEIC) URI schemes → disk cache
  imaging.rs              open_oriented(): shared loader (EXIF rotation applied, ICC + EXIF kept); open_scaled() for thumbs
  heic/mod.rs             is_heic, exif_block (kamadak-exif, any OS), decode/dimensions (error off macOS)
  heic/imageio.rs         macOS only: ImageIO decode (rotated upright, colour profile kept) via objc2 crates
  info.rs                 image_info: dimensions + EXIF fields
  edit/mod.rs             Operation trait, EditOp enum, apply_ops, run_edit, apply_edits command
  edit/crop.rs            Crop operation
  edit/adjust.rs          Adjust operation: temperature, brightness, contrast, saturation → one colour matrix
  edit/color.rs           ColorMatrix, compose, apply (8/16-bit/float, alpha untouched, grey → RGB)
  edit/output.rs          safe saving: temp file → rename; Replace = trash original then rename
  state.rs                AppState: allowed folders + thumbnail semaphore
  error.rs                AppError (serialized to the frontend as a string)
.github/workflows/release.yml   tag-triggered release build (macOS arm64 + Windows)
```

## Architecture rules (keep these)

- **Images never go through IPC.** Full-size images use Tauri's asset protocol
  (`convertFileSrc(path)`), and thumbnails use our `thumb://` scheme (`convertFileSrc(path, "thumb")`).
- **Per-folder access.** The asset scope starts empty. `open_path` grants a folder to both the
  asset scope and `AppState`. Every command and `thumb://` must check `state.is_allowed(path)`.
- **All `invoke` calls live in `src/lib/api.ts`.** TS types there mirror the Rust structs by
  hand. Keep them in sync (serde field names are snake_case unless renamed; `EditOp` / `SaveMode` are camelCase).
- **Commands are `async` and do blocking work in `tauri::async_runtime::spawn_blocking`.**
- **Editing:** the frontend only sends operations as data (`[{ type: "crop", x, y, width, height }]`,
  in *displayed* pixel coordinates). Rust loads with EXIF orientation applied, runs ops, and re-encodes
  in the original format (JPEG q92, WebP lossless), keeping ICC + EXIF with the orientation reset.
  GIFs are not editable.
- **Saving is never destructive:** write a temp file first; "Replace" moves the original to the Trash.
  Trash from the UI is delayed by a 5 s Undo window (nothing is trashed until it expires).
- **Cache busting:** `ImageEntry.modified` is **milliseconds**. Image URLs carry
  `?v=${modified}-${size}` (`versionOf`), and React keys / view state include it, so files
  replaced in place reload.
- **Keyboard:** one window listener per component, using the "ref to latest handler" pattern.
  In `view === "edit"`, App ignores keys and EditMode handles its own.
  Keys in use (grid / viewer): arrows, Enter, Space, Esc, ⌫/Delete, `+ − 0 1`, `C` crop, `A` adjust,
  `R` rotate view, `I` info, `F` full screen, `?`, ⌘O, ⌘F, ⌘Z. On a focused recent folder (sidebar or
  welcome screen), ⌫/Delete removes it from the list: `components/recentKeys.ts` stops the event so App's
  window listener doesn't also trash the selected image. Editor: `C` / `A` switch tool,
  arrows (crop nudge, or the focused slider), ⌘S save copy, Esc cancel. Check this list before adding one.
- **Opening the editor on a tool:** `startEdit(entry, toolId)` in App.tsx stores `editTool` and passes it
  as `EditMode`'s `initialTool`; the viewer's `onEdit(toolId)` buttons use the same path.

### Adding an edit tool (e.g. rotate)
1. Rust: `src-tauri/src/edit/<tool>.rs` with a params struct + `impl Operation`; add an
   `EditOp` variant and its arm in `EditOp::operation` (the compiler enforces the arm).
2. TS: add the op to the `EditOp` union in `src/edit/types.ts`.
3. UI: `src/edit/tools/<tool>/` exporting `defineTool({ id, label, shortcut, icon, init, isNoop, toOps, Controls?, Overlay?, Panel?, colorMatrix? })`,
   then add it to `src/edit/tools/index.ts`.
4. Add Rust tests (see `imaging::test_support` for fixtures), and update the shortcuts sheet, README and CHANGELOG.

Known limits: ops run in registry order (geometry tools first).

### Colour adjustments and the preview
- Preview = each tool's optional `colorMatrix(state)`, composed by `EditMode` and drawn with one SVG
  `<feColorMatrix>` (`color-interpolation-filters="sRGB"`) on the editor `<img>`, whichever tool is active.
- The formulas exist twice: `tools/adjust/adjustments.ts` and `edit/adjust.rs`. Change both, and update the
  `matches_frontend_matrix` test (get the numbers by running the TS `matrixOf`). Order: temperature,
  brightness, contrast, saturation.
- A new Adjust slider = one `ADJUSTMENTS` entry in TS + a field, fn and `Adjust::matrix` line in Rust.
- Adjustments that aren't affine per-pixel maps (curves, vibrance, sharpening) can't use `colorMatrix`;
  they'd need a new preview path (e.g. `feComponentTransfer`, or a Rust-rendered preview).
- Slider meaning: brightness and contrast are 2^(v/100) (±1 stop; contrast pivots on 0.5), saturation is
  1 + v/100 around Rec. 709 luma, temperature scales R / B by ±20 %. Values are integers −100…100;
  Rust rejects anything outside that range.
- The SVG holding the filter uses `.svg-defs` (0×0, absolutely positioned), not `display: none`,
  because some engines ignore filters inside hidden SVGs. The filter id is a constant (one editor at a time).
- Tools with a `Panel` render it to the right of the stage inside `.editor-body`; the stage re-fits,
  which is fine because tool state (e.g. the crop rect) is in image pixels.
- Not yet verified: slider smoothness in the macOS WebKit webview on very large photos, and small
  preview/saved differences for wide-gamut (Display P3) photos.

### HEIC (macOS only)
- `library::EXTS` (and `IMAGE_EXTS` in api.ts) list `heic`/`heif` only on macOS. Windows never sees them.
- Rust decodes with ImageIO (`heic/imageio.rs`): `CGImageSourceCreateThumbnailAtIndex` with
  `CreateThumbnailWithTransform` + `ThumbnailMaxPixelSize` (full size, or 560 for thumbs), then drawn into an
  RGBA buffer in the photo's own colour space so its ICC profile (Display P3) stays valid.
- iPhone HEIC stores rotation in the container *and* EXIF Orientation; pixels come out upright, so
  `imaging::clean_exif` resets the EXIF flag (otherwise saved JPEGs would rotate twice).
- Display: `fullSrc()` uses `preview://` for HEIC (thumbs.rs, `Kind::Preview`), a full-size JPEG with the ICC
  profile. Full size matters: the editor's crop coordinates come from the `<img>`'s natural size.
- Editing: HEIC can't be written, so `run_edit` refuses `Replace` before decoding, `output::save` writes
  `name (edited).jpg` (`unique_edited_path(original, Some("jpg"))`), and EditMode shows "Save as JPEG copy".
- This code can't be compiled in the cloud workspace (no macOS std there). Verify on the Mac:
  `cargo test` runs the macOS-only decoder tests against `test-data/rotated.heic`.

## Releasing

Version lives in **three files**; keep them equal: `src-tauri/tauri.conf.json` (authoritative:
installer names + workflow tag check), `package.json`, `src-tauri/Cargo.toml`. The lockfiles
copy it too: the `spektro_photo` entry in `src-tauri/Cargo.lock` and the top-level `version`
(two places) in `package-lock.json`; bump those in the same commit.

Flow (this is how 0.1.2 went out):
1. On `dev`: bump versions, move `CHANGELOG.md`'s `[Unreleased]` items under `[X.Y.Z] - date`
   (new empty `[Unreleased]` above, fix the compare links at the bottom), update the README's
   "Current version" and "What's new". Commit, `git push origin dev`.
2. PR `dev` → `main` on GitHub. 0.1.2 used **squash and merge** (one commit on `main`, history stays
   clean); PRs #1–#4 were normal merge commits. Either works; squash needs step 5.
3. Tag on an up-to-date `main` (the local `main` has been stale before, so always pull), check,
   push **only the tag** (never `git push --tags`):
   ```bash
   git checkout main
   git pull origin main
   git tag -a v0.1.3 -m "Spektro Photo 0.1.3"
   git show v0.1.3:src-tauri/tauri.conf.json | grep '"version"'
   git push origin v0.1.3
   ```
4. GitHub Actions checks the tag against `tauri.conf.json`, builds macOS (signed + notarized) and
   Windows in parallel, and uploads to a **draft** release. Check the `.dmg` with `spctl`, paste the
   CHANGELOG section into the notes, publish.
5. After a squash merge, `dev` still holds the original commits; bring it level so the next PR is clean:
   ```bash
   git checkout dev
   git merge main
   git push origin dev
   ```
6. Optional announcement: X post drafts plus a 16:9 promo image (made from a real editor render in a
   Chromium harness; see "Verifying without a Mac" below). Post only after publishing, because
   `releases/latest` still points at the previous version until then.

- The workflow runs only on `v*` tag pushes (or manually). Branch pushes and PRs don't trigger it.
- Tag **after** committing and merging. Tags point at a commit; deleting a tag that was never
  pushed is safe (`git tag -d`). A pushed tag whose build failed can be removed while the release is
  still a draft (`git push --delete origin vX.Y.Z`, then `git tag -d vX.Y.Z`); never move or reuse
  the tag of a published release; ship the next patch version instead.
- Update `CHANGELOG.md` (Keep a Changelog format, with an `Unreleased` section) and the README's
  "Current version" / "What's new" on each release.
- macOS signing / notarization uses repo secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`.
  Local signing reads the same variables from `~/.config/image-viewer/signing.env` (outside the repo).
  First-ever notarization for the team took hours; later ones take minutes.
- `tauri.conf.json` still has `bundle.macOS.signingIdentity: "-"` (ad-hoc). The CI secret should
  override it. Verify a release with `spctl -a -vvv "/Volumes/Spektro Photo/Spektro Photo.app"`
  (expect `source=Notarized Developer ID`). If not, remove that block.

## Gotchas learned the hard way

- The bundle identifier must not contain `_` (it's `com.avirup171.image-viewer`). Changing it resets app data.
- **Naming (renamed in 0.1.3):** the visible name is `productName` "Spektro Photo" (also window title,
  `index.html`, release title). The identifier deliberately keeps the old `image-viewer`: it's what macOS and
  Windows use to find settings, recents and the thumbnail cache, and users never see it. Crate is
  `spektro_photo` (lib `spektro_photo_lib`), npm package `spektro-photo`.
- The MSI `upgradeCode` is pinned in `tauri.conf.json` (`bundle.windows.wix`) to the value derived from the
  old name. Never change it, or MSI updates install side by side. The NSIS `-setup.exe` keys its install
  folder and registry entry on `productName`, so the 0.1.3 rename installs next to the old app (users
  uninstall "Image Viewer" once).
- `~/.config/image-viewer/signing.env` (local signing secrets, outside the repo) kept its old folder name.
- `cargo test` replace-mode tests really move a temp file to the system Trash; that's expected.
- After a version bump, `Cargo.lock` changes on the next build; commit it. `package-lock.json` was
  left at 0.1.0 until 0.1.2; keep it in step too.
- The owner uses zsh: don't put `# comments` on the same line as commands you ask them to paste.
- Never write scratch files (tarballs, logs, harnesses) into the repo folder: a `.claude-snapshot.tgz`
  got committed on `dev` this way (it never reached `main`, thanks to the squash merge). Keep scratch
  work in the cloud workspace or outside the repo.

## Verifying without a Mac (for Claude)

- The shell on the owner's machine (the Cowork VM) has Node but **no Rust**, and can't show windows.
  `npx tsc` works there; for Rust, copy the repo (without `node_modules`, `target`, `.git`) to the
  cloud workspace and run `cargo test` / `cargo clippy` there. Compiling Tauri on Linux needs
  `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev`, and a cold build takes 10+ min
  on 2 cores. Copy changed files back and re-run `npx tsc` on the device.
- UI and preview checks: a tiny Vite page outside `src/` that renders `EditMode` with
  `window.__TAURI_INTERNALS__ = { convertFileSrc: p => p, invoke: async () => { throw "mock" } }`,
  screenshotted with Playwright Chromium (≈ Windows' WebView2, not macOS WebKit). For the Adjust tool,
  screenshot flat colour patches and compare them with the matrix maths (they matched exactly).
  Set a Mac user agent if the screenshot should show ⌘ rather than Ctrl.
- The Rust code isn't rustfmt-formatted (long lines are the house style); match the surrounding code
  rather than running `cargo fmt` over existing files.
- macOS-only Rust (`#[cfg(target_os = "macos")]`, e.g. `heic/imageio.rs`) can't be type-checked there:
  `rustup target add aarch64-apple-darwin` is blocked. Read the binding signatures from the crate sources
  (`cargo fetch`, then `~/.cargo/registry/src/*/objc2-*`), keep the macOS part small, and ask the owner
  to run `cargo test` on the Mac.

## Working agreements

- Explain changes (what and why) in plain terms; this is a learning project.
- Don't silently change lines the owner added. If something they wrote breaks the build,
  say so and ask, or explain clearly what you changed.
- Don't run git commands that write to the repo (commit, fetch, tag, push) unless asked;
  give the commands instead. Read-only git (`status`, `log`, `show`) is fine.
- Verify before claiming: run `npx tsc` and `cargo test`, and say what wasn't tested
  (e.g. the real macOS UI, signing, the Windows build).
- Keep the UI consistent with the existing dark theme and tokens in `App.css`; touch targets ≥ 32 px;
  every action has a keyboard shortcut listed in `Overlays.tsx`.
