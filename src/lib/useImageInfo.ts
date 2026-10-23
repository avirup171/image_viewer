import { useEffect, useState } from "react";
import { getImageInfo, type ImageInfo } from "./api";

/**
 * Fetch dimensions + EXIF for `path`. `delay` debounces fast changes, e.g.
 * holding an arrow key in the grid shouldn't fire a request per tile.
 */
export function useImageInfo(path: string | null | undefined, delay = 0) {
  const [result, setResult] = useState<{ path: string; info: ImageInfo } | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      getImageInfo(path)
        .then((info) => {
          if (!cancelled) setResult({ path, info });
        })
        .catch(() => {
          // Unreadable metadata just means the panel shows less.
        });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [path, delay]);

  // Never show the previous image's info for the current one.
  return result && result.path === path ? result.info : null;
}
