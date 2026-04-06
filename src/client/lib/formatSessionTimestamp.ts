/**
 * Format a room's `created_at` (ms epoch) as a short local-time string,
 * e.g. "4/5 10:30p". Uses the browser's local timezone.
 * If the date matches today, returns "Today 10:30p" instead.
 */
export function formatSessionTimestamp(createdAt: number): string {
  const d = new Date(createdAt)
  const now = new Date()

  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()

  let hours = d.getHours()
  const minutes = d.getMinutes()
  const suffix = hours >= 12 ? 'p' : 'a'
  hours = hours % 12 || 12

  const timeStr = `${hours}:${String(minutes).padStart(2, '0')}${suffix}`
  const dateStr = isToday ? 'Today' : `${d.getMonth() + 1}/${d.getDate()}`

  return `${dateStr} ${timeStr}`
}
