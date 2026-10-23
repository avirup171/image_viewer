import { memo, useEffect, useState, type RefObject } from "react";
import { thumbSrc, formatBytes, modKey, type Folder, type ImageEntry } from "../lib/api";
import type { Recent } from "../lib/storage";
import { useImageInfo } from "../lib/useImageInfo";
import { ChevronRightIcon, FolderIcon, PlusIcon, SearchIcon } from "./Icons";

export type SortKey = "name" | "date" | "size";
export const THUMB_MIN = 96;
export const THUMB_MAX = 280;

type Props = {
  folder: Folder;
  visible: ImageEntry[];
  total: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
  filter: string;
  onFilter: (q: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  thumbSize: number;
  onThumbSize: (n: number) => void;
  recents: Recent[];
  onOpenRecent: (dir: string) => void;
  onOpenFolder: () => void;
  filterRef: RefObject<HTMLInputElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
};

export function Library(p: Props) {
  const selected = p.visible.find((i) => i.path === p.selectedPath) ?? null;
  // Debounced so holding an arrow key doesn't fire a request per tile.
  const info = useImageInfo(selected?.path, 150);

  // Keep the selected tile on screen when moving with the keyboard.
  useEffect(() => {
    if (!p.selectedPath || !p.gridRef.current) return;
    const el = p.gridRef.current.querySelector(`[data-path="${CSS.escape(p.selectedPath)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [p.selectedPath, p.gridRef]);

  return (
    <div className="library">
      <div className="toolbar">
        <nav className="crumbs" aria-label="Current folder">
          {p.folder.parent_name && (
            <>
              <span className="muted">{p.folder.parent_name}</span>
              <ChevronRightIcon size={14} />
            </>
          )}
          <span className="strong">{p.folder.name}</span>
        </nav>
        <div className="spacer" />
        <label className="search">
          <SearchIcon size={14} />
          <input
            ref={p.filterRef}
            type="search"
            value={p.filter}
            onChange={(e) => p.onFilter(e.target.value)}
            placeholder={`Filter by name   ${modKey}F`}
            aria-label="Filter images by name"
            spellCheck={false}
          />
        </label>
        <label className="muted small row-tight">
          Sort
          <select value={p.sort} onChange={(e) => p.onSort(e.target.value as SortKey)} aria-label="Sort images by">
            <option value="name">Name</option>
            <option value="date">Date modified</option>
            <option value="size">Size</option>
          </select>
        </label>
        <label className="size-slider row-tight" title="Thumbnail size (+ / −)">
          <span className="sq small-sq" aria-hidden="true" />
          <input
            type="range"
            min={THUMB_MIN}
            max={THUMB_MAX}
            step={8}
            value={p.thumbSize}
            onChange={(e) => p.onThumbSize(Number(e.target.value))}
            aria-label="Thumbnail size"
          />
          <span className="sq" aria-hidden="true" />
        </label>
      </div>

      <div className="library-body">
        <aside className="sidebar">
          <h2 className="eyebrow">Recent folders</h2>
          {p.recents.map((r) => (
            <button
              key={r.dir}
              className={"side-item" + (r.dir === p.folder.dir ? " active" : "")}
              onClick={() => p.onOpenRecent(r.dir)}
              title={r.dir}
            >
              <FolderIcon size={16} />
              <span className="ellipsis">{r.name}</span>
            </button>
          ))}
          <div className="spacer" />
          <button className="side-item dashed" onClick={p.onOpenFolder}>
            <PlusIcon size={16} /> Open folder…
          </button>
        </aside>

        <main className="grid-scroll">
          {p.total === 0 ? (
            <EmptyState title="No images in this folder" hint="Supported: JPEG, PNG, GIF, WebP, BMP" />
          ) : p.visible.length === 0 ? (
            <EmptyState title={`No images match “${p.filter}”`} hint="Press Esc to clear the filter" />
          ) : (
            <div
              ref={p.gridRef}
              className="grid"
              style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${p.thumbSize}px, 1fr))` }}
            >
              {p.visible.map((img) => (
                <Tile
                  key={img.path}
                  entry={img}
                  selected={img.path === p.selectedPath}
                  onSelect={p.onSelect}
                  onOpen={p.onOpen}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span>
          {p.visible.length === p.total ? p.total : `${p.visible.length} of ${p.total}`}{" "}
          {p.total === 1 ? "image" : "images"}
        </span>
        {selected && (
          <>
            <span aria-hidden="true">·</span>
            <span className="strong ellipsis">{selected.name}</span>
            <span>
              {info?.width && info.height ? `${info.width} × ${info.height} · ` : ""}
              {formatBytes(selected.size)}
            </span>
          </>
        )}
        <div className="spacer" />
        <span className="hide-narrow">Double-click or ↵ to open · ⌫ to trash</span>
      </footer>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="empty">
      <p className="strong">{title}</p>
      <p className="muted small">{hint}</p>
    </div>
  );
}

type TileProps = {
  entry: ImageEntry;
  selected: boolean;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
};

// memo: with hundreds of tiles, only the two whose `selected` changed re-render
// when you press an arrow key (needs stable onSelect/onOpen from App).
const Tile = memo(function Tile({ entry, selected, onSelect, onOpen }: TileProps) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  return (
    <button
      className={"tile" + (selected ? " selected" : "")}
      data-path={entry.path}
      // Roving tabindex: Tab lands on the selected tile, not on every tile.
      tabIndex={selected ? 0 : -1}
      aria-label={entry.name}
      aria-current={selected || undefined}
      onClick={() => onSelect(entry.path)}
      onDoubleClick={() => onOpen(entry.path)}
    >
      <span className="tile-img" data-state={state}>
        {/* loading="lazy": only tiles near the viewport request a thumbnail */}
        <img
          src={thumbSrc(entry.path)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
        />
        {state === "loading" && <span className="spinner" aria-hidden="true" />}
        {state === "error" && <span className="tile-broken">Can’t preview</span>}
      </span>
      <span className="tile-name">{entry.name}</span>
    </button>
  );
});
