// Story 12-2 AC #10: when the desktop Spotify SDK is mid-re-init, play/pause
// clicks are stashed here. On the next `ready` event the stashed action is
// fired iff it's still recent; otherwise it's dropped (a stale re-init should
// not replay a click the user made several seconds ago).
//
// Extracted as a pure helper so the 10s TTL invariant is testable without
// mounting the full HostRoomPage component.

export interface PendingPlayAction {
  fn: () => void
  t: number
}

export const PENDING_PLAY_TTL_MS = 10_000

export function shouldFlushPending(
  pending: PendingPlayAction | null,
  now: number,
  ttlMs: number = PENDING_PLAY_TTL_MS,
): boolean {
  if (!pending) return false
  return now - pending.t < ttlMs
}
