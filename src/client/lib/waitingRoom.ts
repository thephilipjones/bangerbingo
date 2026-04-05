/**
 * Pure helper functions for the guest waiting room.
 * These are tested in GuestWaitingRoom.test.ts (logic-only, no DOM render tests).
 */

/**
 * Compute total player count including host.
 * - If hostName is null, count is just the number of guests.
 * - If hostName is set, count includes the host + guests.
 */
export function computePlayerCount(players: string[], hostName: string | null): number {
  const guestCount = players.length
  return hostName ? guestCount + 1 : guestCount
}

/**
 * Determine if a row name matches the current user (case-sensitive exact match).
 * Used to display "(you)" suffix next to the user's own row.
 */
export function isSelfRow(rowName: string, selfName: string): boolean {
  return rowName === selfName
}
