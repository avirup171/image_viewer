import { useEffect, useState } from "react";
import { getImageInfo, type ImageInfo } from "./api";

/**
 * Fetch dimensions + EXIF for `path`. `delay` debounces fast changes, e.g.
 * holding an arrow key in the grid shouldn't fire a request per tile.
 * `version` (see versionOf) makes it re-read a file that was edited in place.
 */
export function useImageInfo(path: string | null | undefined, delay = 0, version = "") {
  const [result, setResult] = useState<{ key: string; info: ImageInfo } | null>(null);
  const key = path ? `${path}|${version}` : "";

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      getImageInfo(path)
        .then((info) => {
          if (!cancelled) setResult({ key, info });
        })
        .catch(() => {
          // Unreadable metadata just means the panel shows less.
        });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [path, delay, key]);

  // Never show the previous image's info for the current one.
  return result && result.key === key ? result.info : null;
}
