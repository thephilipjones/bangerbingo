/**
 * Format a room's `created_at` (ms epoch) as a short local-time string,
 * e.g. "Apr 5, 14:32". Uses the runtime's default locale / timezone.
 *
 * Exact punctuation/spacing may vary slightly across runtimes — callers
 * should NOT snapshot-test this output.
 */
export function formatSessionTimestamp(createdAt: number): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return fmt.format(new Date(createdAt))
}
