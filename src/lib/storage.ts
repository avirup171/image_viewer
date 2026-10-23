// Small per-user preferences (thumbnail size, sort, recents) in localStorage.
// It persists in Tauri's webview between launches. Every access is wrapped in
// try/catch so a blocked or corrupted store never breaks the app.

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not fatal: the preference just won't be remembered.
  }
}

export type Recent = { dir: string; name: string; count: number };

const MAX_RECENTS = 8;

export function addRecent(list: Recent[], r: Recent): Recent[] {
  return [r, ...list.filter((x) => x.dir !== r.dir)].slice(0, MAX_RECENTS);
}
