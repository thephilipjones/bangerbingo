// Pure helpers extracted from RoundConfigOverlay so the validation + payload-building
// logic can be unit-tested without a DOM. The overlay component imports and uses these.

import type { StartRoundPayload } from './api.ts'

export interface HostNameValidation {
  trimmed: string | null
  error: string | null
}

/** Validates the host name input. Returns `trimmed: null` when the field is not required. */
export function validateHostName(input: string, required: boolean): HostNameValidation {
  if (!required) return { trimmed: null, error: null }
  const trimmed = input.trim()
  if (trimmed.length < 1 || trimmed.length > 30) {
    return { trimmed: null, error: 'Please enter your name (1–30 characters)' }
  }
  return { trimmed, error: null }
}

export function buildStartRoundPayload(
  playlistId: string,
  clipDuration: number | 'full',
  titleRevealDelay: number | null,
  hostName: string | null,
): StartRoundPayload {
  return {
    playlistId,
    clipDuration,
    titleRevealDelay,
    ...(hostName ? { hostName } : {}),
  }
}
