import { formatBytes, formatDate, isMac, type ImageEntry, type ImageInfo } from "../lib/api";

type Props = {
  entry: ImageEntry;
  dir: string;
  info: ImageInfo | null;
  onReveal: () => void;
  onCopyPath: () => void;
  onTrash: () => void;
};

export function InfoPanel({ entry, dir, info, onReveal, onCopyPath, onTrash }: Props) {
  const file: [string, string][] = [
    ["Dimensions", info?.width && info.height ? `${info.width} × ${info.height}` : "—"],
    ["Size", formatBytes(entry.size)],
    ["Type", info?.format ?? "—"],
    ["Modified", formatDate(entry.modified)],
  ];

  return (
    <aside className="info-panel" aria-label="Image information">
      <div className="info-head">
        <h2>{entry.name}</h2>
        <span className="muted small break">{dir}</span>
      </div>

      <Group title="File" rows={file} />
      {info && info.camera.length > 0 ? (
        <Group title="Camera" rows={info.camera.map((f) => [f.label, f.value])} />
      ) : (
        info && <p className="muted small">No camera data in this file.</p>
      )}

      <div className="spacer" />
      <div className="info-actions">
        <button className="btn" onClick={onReveal}>
          {isMac ? "Reveal in Finder" : "Show in folder"}
        </button>
        <div className="row">
          <button className="btn grow" onClick={onCopyPath}>
            Copy path
          </button>
          <button className="btn danger grow" onClick={onTrash}>
            Move to Trash
          </button>
        </div>
      </div>
    </aside>
  );
}

function Group({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="info-group">
      <h3 className="eyebrow">{title}</h3>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="info-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
