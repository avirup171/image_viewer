import type { Recent } from "../lib/storage";
import { modKey } from "../lib/api";
import { CloseIcon, FolderIcon, PhotoIcon } from "./Icons";
import { removeOnDelete } from "./recentKeys";

type Props = {
  recents: Recent[];
  dragging: boolean;
  onOpenFolder: () => void;
  onOpenImage: () => void;
  onOpenRecent: (dir: string) => void;
  onRemoveRecent: (dir: string) => void;
};

export function Welcome({ recents, dragging, onOpenFolder, onOpenImage, onOpenRecent, onRemoveRecent }: Props) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className={"dropzone" + (dragging ? " active" : "")}>
          <PhotoIcon size={44} />
          <h1>{dragging ? "Drop to open" : "Drop a folder or images here"}</h1>
          <p className="muted">Your photos stay where they are. Nothing is copied, moved or uploaded.</p>
          <div className="row">
            <button className="btn primary" onClick={onOpenFolder}>
              Open folder <kbd className="on-accent">{modKey}O</kbd>
            </button>
            <button className="btn" onClick={onOpenImage}>
              Open image…
            </button>
          </div>
        </div>

        {recents.length > 0 && (
          <section className="recents">
            <h2 className="eyebrow">Recent folders</h2>
            {recents.map((r) => (
              <div key={r.dir} className="recent-row" onKeyDown={removeOnDelete(() => onRemoveRecent(r.dir))}>
                <button className="recent" onClick={() => onOpenRecent(r.dir)}>
                  <span className="recent-icon">
                    <FolderIcon size={20} />
                  </span>
                  <span className="recent-text">
                    <span className="recent-name">{r.name}</span>
                    <span className="muted small ellipsis">{r.dir}</span>
                  </span>
                  <span className="muted small">
                    {r.count} {r.count === 1 ? "image" : "images"}
                  </span>
                </button>
                <button
                  className="remove-x"
                  onClick={() => onRemoveRecent(r.dir)}
                  aria-label={`Remove ${r.name} from recent folders`}
                  title="Remove from recent folders (⌫). The folder itself isn’t touched."
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            ))}
          </section>
        )}

        <p className="muted small center">
          Press <kbd>?</kbd> any time to see keyboard shortcuts
        </p>
      </div>
    </div>
  );
}
