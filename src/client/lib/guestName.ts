const STORAGE_KEY = 'bangerbingo.guestName'

/** Reads the stored guest name from localStorage, trimmed. Returns '' on any failure. */
export function getStoredGuestName(): string {
  try {
    return (localStorage.getItem(STORAGE_KEY) ?? '').trim()
  } catch {
    return ''
  }
}

/** Writes the trimmed guest name to localStorage. Silently swallows failures
 *  (Safari private mode, ITP eviction, quota exceeded). */
export function setStoredGuestName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name.trim())
  } catch {
    // swallow: Safari private mode / quota / disabled storage
  }
}
