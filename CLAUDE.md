# CLAUDE.md

Context for Claude when working on this repository.

## Project

**Image Viewer**: a small, fast desktop image viewer for macOS (Apple Silicon) and Windows.
Personal learning / side project by Avirup Basu (GitHub: `avirup171/image_viewer`, MIT).
The owner is an experienced Rust developer who is newer to Tauri and frontend work:
explain *why* when changing things, and keep the app simple. It's a viewer with basic
editing, not a photo editor.

- Stack: **Tauri 2** (Rust backend) + **React 19 + TypeScript + Vite** frontend, plain CSS.
- Current version: **0.1.2** (adjust tool: temperature, brightness, contrast, saturation).
  Released versions: `v0.1.0`, `v0.1.1`; `v0.1.2` is being released.
- Roadmap: rotate / flip, resize, live folder
  watching (`notify`), persisting folder access across restarts, Windows code signing, HEIC / RAW.

## Commands

```bash
npm ci                      # install frontend deps
npm run tauri dev           # run the app (Vite on :1420 + Rust)
npx tsc                     # type-check; run before any release build
(cd src-tauri && cargo test)    # Rust unit tests (edit pipeline, EXIF, saving)
(cd src-tauri && cargo clippy --lib --tests)
npm run tauri build         # release build → src-tauri/target/release/bundle/{macos,dmg}
```

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
  thumbs.rs               thumb:// async URI scheme: decode → resize (560px) → disk cache
  imaging.rs              open_oriented(): shared loader (EXIF rotation applied, ICC + EXIF kept)
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

## Releasing

Version lives in **three files**; keep them equal: `src-tauri/tauri.conf.json` (authoritative:
installer names + workflow tag check), `package.json`, `src-tauri/Cargo.toml`.

Flow: work on `dev` → bump version in all three → commit → PR `dev` → `main` → tag the
merged commit → push **only that tag** → GitHub Actions builds a **draft** release → review →
publish.

```bash
git tag -a v0.1.2 -m "Image Viewer 0.1.2"
git show v0.1.2:src-tauri/tauri.conf.json | grep '"version"'   # must match
git push origin v0.1.2
```

- The workflow runs only on `v*` tag pushes (or manually). Branch pushes and PRs don't trigger it.
- Tag **after** committing and merging. Tags point at a commit; deleting a tag that was never
  pushed is safe (`git tag -d`).
- Update `CHANGELOG.md` (Keep a Changelog format, with an `Unreleased` section) and the README's
  "Current version" / "What's new" on each release.
- macOS signing / notarization uses repo secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`.
  Local signing reads the same variables from `~/.config/image-viewer/signing.env` (outside the repo).
  First-ever notarization for the team took hours; later ones take minutes.
- `tauri.conf.json` still has `bundle.macOS.signingIdentity: "-"` (ad-hoc). The CI secret should
  override it. Verify a release with `spctl -a -vvv "/Volumes/Image Viewer/Image Viewer.app"`
  (expect `source=Notarized Developer ID`). If not, remove that block.

## Gotchas learned the hard way

- The bundle identifier must not contain `_` (it's `com.avirup171.image-viewer`). Changing it resets app data.
- `cargo test` replace-mode tests really move a temp file to the system Trash; that's expected.
- After a version bump, `Cargo.lock` changes on the next build; commit it.
- The owner uses zsh: don't put `# comments` on the same line as commands you ask them to paste.

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
