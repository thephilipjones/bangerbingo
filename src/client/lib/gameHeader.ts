/**
 * Pure helper for the game header component.
 */

/**
 * Convert a 0-based song index to an ordinal display string.
 * e.g. 0 → "1st Song", 1 → "2nd Song", 2 → "3rd Song", 3 → "4th Song"
 */
export function formatSongOrdinal(songIndex: number): string {
  const n = songIndex + 1
  const suffix = getOrdinalSuffix(n)
  return `${n}${suffix} Song`
}

function getOrdinalSuffix(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return 'th'
  const mod10 = n % 10
  if (mod10 === 1) return 'st'
  if (mod10 === 2) return 'nd'
  if (mod10 === 3) return 'rd'
  return 'th'
}
