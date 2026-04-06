/**
 * Pure helper functions for the guest waiting room.
 * These are tested in GuestWaitingRoom.test.ts (logic-only, no DOM render tests).
 */

/**
 * Compute total player count including host.
 * The host is always counted regardless of whether their name has resolved.
 */
export function computePlayerCount(players: string[]): number {
  return players.length + 1
}

/**
 * Determine if a row name matches the current user (case-sensitive exact match).
 * Used to display "(you)" suffix next to the user's own row.
 */
export function isSelfRow(rowName: string, selfName: string): boolean {
  return rowName === selfName
}
