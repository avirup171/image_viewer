import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { IMAGE_EXTS, openPath, trashImage, type Folder, type ImageEntry } from "./lib/api";
import { addRecent, load, save, type Recent } from "./lib/storage";
import { Welcome } from "./components/Welcome";
import { Library, THUMB_MAX, THUMB_MIN, type SortKey } from "./components/Library";
import { Viewer } from "./components/Viewer";
import { ShortcutsOverlay, Toast, type ToastState } from "./components/Overlays";
import "./App.css";
import { invoke } from "@tauri-apps/api/core";

const UNDO_MS = 5000;

const compare: Record<SortKey, (a: ImageEntry, b: ImageEntry) => number> = {
  // numeric: true gives natural order, so IMG_2 comes before IMG_10
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  date: (a, b) => b.modified - a.modified, // newest first
  size: (a, b) => b.size - a.size, // largest first
};

/** A trash that hasn't happened yet: the file is hidden, the Undo toast is up. */
type Pending = { entry: ImageEntry; index: number; dir: string; timer: number };

export default function App() {
  // ---- state ----------------------------------------------------------------
  const [folder, setFolder] = useState<Folder | null>(null);
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [view, setView] = useState<"grid" | "viewer">("grid");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>(() => load("sort", "name"));
  const [thumbSize, setThumbSize] = useState(() => load("thumbSize", 152));
  const [infoOpen, setInfoOpen] = useState(() => load("infoOpen", false));
  const [recents, setRecents] = useState<Recent[]>(() => load("recentFolders", []));
  const [toast, setToast] = useState<ToastState | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const pendingRef = useRef<Pending | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const folderDirRef = useRef<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Remember preferences between launches.
  useEffect(() => save("sort", sort), [sort]);
  useEffect(() => save("thumbSize", thumbSize), [thumbSize]);
  useEffect(() => save("infoOpen", infoOpen), [infoOpen]);
  useEffect(() => save("recentFolders", recents), [recents]);

  // What the grid and viewer show: filtered, then sorted.
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? images.filter((i) => i.name.toLowerCase().includes(q)) : images.slice();
    return list.sort(compare[sort]);
  }, [images, filter, sort]);
  const selectedIndex = visible.findIndex((i) => i.path === selectedPath);

  // Keep a valid selection when the list changes; leave the viewer when empty.
  useEffect(() => {
    if (visible.length > 0 && selectedIndex === -1) setSelectedPath(visible[0].path);
    if (visible.length === 0 && view === "viewer") setView("grid");
  }, [visible, selectedIndex, view]);

  // ---- toasts -----------------------------------------------------------------
  const hideToast = useCallback(() => {
    window.clearTimeout(toastTimer.current);
    setToast(null);
  }, []);
  const showToast = useCallback((message: string, ms = 3000, action?: ToastState["action"]) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, action });
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  // ---- trash with undo ------------------------------------------------------
  // Nothing is sent to the Trash until the Undo window closes, so "undo" is
  // just putting the entry back in the list. Only refs + setters are used, so
  // these callbacks are safe to call from timers and stale closures.
  const restore = useCallback((p: Pending) => {
    if (folderDirRef.current !== p.dir) return; // user moved to another folder
    setImages((list) => {
      const copy = list.slice();
      copy.splice(Math.min(p.index, copy.length), 0, p.entry);
      return copy;
    });
  }, []);

  const commitPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pendingRef.current = null;
    trashImage(p.entry.path).catch((e) => {
      restore(p);
      showToast(`Couldn’t move ${p.entry.name} to Trash: ${e}`, 5000);
    });
  }, [restore, showToast]);

  const undoTrash = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pendingRef.current = null;
    restore(p);
    setSelectedPath(p.entry.path);
    hideToast();
  }, [restore, hideToast]);

  function requestTrash(entry: ImageEntry | undefined) {
    if (!entry || !folder) return;
    commitPending(); // a previous pending trash happens now
    const index = images.findIndex((i) => i.path === entry.path);
    const vi = visible.findIndex((i) => i.path === entry.path);
    const next = visible[vi + 1] ?? visible[vi - 1] ?? null;
    setImages((list) => list.filter((i) => i.path !== entry.path));
    setSelectedPath(next?.path ?? null);
    pendingRef.current = {
      entry,
      index,
      dir: folder.dir,
      timer: window.setTimeout(commitPending, UNDO_MS),
    };
    showToast(`${entry.name} moved to Trash`, UNDO_MS, { label: "Undo", run: undoTrash });
  }

  // If the window closes during the Undo window, carry out the trash.
  useEffect(() => {
    window.addEventListener("beforeunload", commitPending);
    return () => window.removeEventListener("beforeunload", commitPending);
  }, [commitPending]);

  // ---- opening ------------------------------------------------------------
  const openAt = useCallback(
    async (path: string, fromRecent = false) => {
      commitPending();
      try {
        const f = await openPath(path);
        folderDirRef.current = f.dir;
        setFolder(f);
        setImages(f.images);
        setFilter("");
        setSelectedPath(f.selected ?? null);
        setView(f.selected ? "viewer" : "grid");
        setRecents((r) => addRecent(r, { dir: f.dir, name: f.name, count: f.images.length }));
        hideToast();
      } catch (e) {
        if (fromRecent) {
          setRecents((r) => r.filter((x) => x.dir !== path));
          showToast("That folder is no longer available, so it was removed from recents.", 4000);
        } else {
          showToast(String(e), 4000);
        }
      }
    },
    [commitPending, hideToast, showToast],
  );

  const pickFolder = useCallback(async () => {
    const dir = await open({ directory: true });
    if (typeof dir === "string") await openAt(dir);
  }, [openAt]);

  const pickImage = useCallback(async () => {
    const file = await open({ multiple: false, filters: [{ name: "Images", extensions: IMAGE_EXTS }] });
    if (typeof file === "string") await openAt(file);
  }, [openAt]);

  const openRecent = useCallback((dir: string) => openAt(dir, true), [openAt]);

  // Stable callbacks for the memoized grid tiles.
  const selectTile = useCallback((path: string) => setSelectedPath(path), []);
  const openTile = useCallback((path: string) => {
    setSelectedPath(path);
    setView("viewer");
  }, []);

  // ---- window: drag & drop, full screen ----------------------------------
  const openAtRef = useRef(openAt);
  openAtRef.current = openAt;
  useEffect(() => {
    // The listener is registered asynchronously; `cancelled` handles React
    // StrictMode mounting effects twice in dev.
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const t = event.payload.type;
        if (t === "enter" || t === "over") setDragging(true);
        else if (t === "leave") setDragging(false);
        else if (t === "drop") {
          setDragging(false);
          const first = event.payload.paths[0];
          if (first) openAtRef.current(first);
        }
      })
      .then((fn) => (cancelled ? fn() : (unlisten = fn)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    // Keep state in sync if full screen is changed from the OS (green button).
    const win = getCurrentWindow();
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    win
      .onResized(async () => setIsFullscreen(await win.isFullscreen()))
      .then((fn) => (cancelled ? fn() : (unlisten = fn)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  async function toggleFullscreen() {
    const win = getCurrentWindow();
    const next = !(await win.isFullscreen());
    await win.setFullscreen(next);
    setIsFullscreen(next);
  }

  async function reveal(path: string) {
    try {
      await revealItemInDir(path);
    } catch (e) {
      showToast(String(e));
    }
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      showToast("Path copied");
    } catch {
      showToast("Couldn’t copy to the clipboard");
    }
  }

  // ---- keyboard -------------------------------------------------------------
  // One window listener, registered once; it calls whatever this render's
  // handler is, so it always sees current state without re-subscribing.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const target = e.target as HTMLElement | null;
    const typing = !!target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);

    if (showShortcuts) {
      if (k === "Escape" || k === "?") {
        e.preventDefault();
        setShowShortcuts(false);
      }
      return;
    }
    if (mod && k.toLowerCase() === "o") {
      e.preventDefault();
      pickFolder();
      return;
    }
    if (mod && k.toLowerCase() === "z" && pendingRef.current) {
      e.preventDefault();
      undoTrash();
      return;
    }
    if (mod && k.toLowerCase() === "f" && folder && view === "grid") {
      e.preventDefault();
      filterRef.current?.focus();
      filterRef.current?.select();
      return;
    }
    if (typing) {
      // Let inputs keep their keys; Esc leaves the filter.
      if (k === "Escape" && target) {
        if (target === filterRef.current) setFilter("");
        target.blur();
      }
      return;
    }
    if (mod || e.altKey) return;
    if (k === "?") {
      setShowShortcuts(true);
      return;
    }
    if (!folder) return;

    const n = visible.length;
    const i = Math.max(0, selectedIndex);

    if (view === "grid") {
      if (k === "Escape") {
        if (filter) setFilter("");
        return;
      }
      if (k === "+" || k === "=") return setThumbSize((s) => Math.min(THUMB_MAX, s + 16));
      if (k === "-" || k === "_") return setThumbSize((s) => Math.max(THUMB_MIN, s - 16));
      if (n === 0) return;
      // Column count comes straight from the browser's grid layout.
      const cols = gridRef.current
        ? getComputedStyle(gridRef.current).gridTemplateColumns.split(" ").length
        : 1;
      let next = -1;
      switch (k) {
        case "ArrowRight": next = Math.min(i + 1, n - 1); break;
        case "ArrowLeft": next = Math.max(i - 1, 0); break;
        case "ArrowDown": next = Math.min(i + cols, n - 1); break;
        case "ArrowUp": next = Math.max(i - cols, 0); break;
        case "Home": next = 0; break;
        case "End": next = n - 1; break;
        case "Enter":
        case " ":
          e.preventDefault();
          setView("viewer");
          return;
        case "Backspace":
        case "Delete":
          e.preventDefault();
          requestTrash(visible[i]);
          return;
        default:
          return;
      }
      e.preventDefault();
      setSelectedPath(visible[next].path);
      return;
    }

    // viewer (zoom / rotate keys live in Viewer.tsx)
    const go = (j: number) => visible[j] && setSelectedPath(visible[j].path);
    switch (k) {
      case "ArrowRight":
      case " ":
        go(i + 1);
        break;
      case "ArrowLeft":
        go(i - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(n - 1);
        break;
      case "Escape":
        if (isFullscreen) toggleFullscreen();
        else setView("grid");
        break;
      case "i":
      case "I":
        setInfoOpen((o) => !o);
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "Backspace":
      case "Delete":
        requestTrash(visible[i]);
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ---- render ---------------------------------------------------------------
  let screen;
  if (!folder) {
    screen = (
      <Welcome
        recents={recents}
        dragging={dragging}
        onOpenFolder={pickFolder}
        onOpenImage={pickImage}
        onOpenRecent={openRecent}
      />
    );
  } else if (view === "viewer" && selectedIndex >= 0) {
    screen = (
      <Viewer
        images={visible}
        index={selectedIndex}
        dir={folder.dir}
        onIndex={(j) => setSelectedPath(visible[j].path)}
        onClose={() => setView("grid")}
        infoOpen={infoOpen}
        onToggleInfo={() => setInfoOpen((o) => !o)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onTrash={requestTrash}
        onReveal={reveal}
        onCopyPath={copyPath}
        keysDisabled={showShortcuts}
      />
    );
  } else {
    screen = (
      <Library
        folder={folder}
        visible={visible}
        total={images.length}
        selectedPath={selectedPath}
        onSelect={selectTile}
        onOpen={openTile}
        filter={filter}
        onFilter={setFilter}
        sort={sort}
        onSort={setSort}
        thumbSize={thumbSize}
        onThumbSize={setThumbSize}
        recents={recents}
        onOpenRecent={openRecent}
        onOpenFolder={pickFolder}
        filterRef={filterRef}
        gridRef={gridRef}
      />
    );
  }

  return (
    <div className="app">
      {screen}
      {folder && dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <p>Drop to open</p>
        </div>
      )}
      <Toast toast={toast} />
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
