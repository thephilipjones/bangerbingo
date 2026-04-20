import type { AudioPreset } from './api.ts'
import type { TitleRevealDelay } from './bingo.ts'

const STORAGE_KEY = 'bb:host-prefs:v1'
const SCHEMA_VERSION = 1

export interface HostPrefs {
  clipDuration: number | 'full'
  titleRevealDelay: TitleRevealDelay
  audioPreset: AudioPreset
  allowCasualMode: boolean
  preferredDeviceId?: string
}

interface StoredHostPrefs extends HostPrefs {
  schemaVersion: 1
}

const VALID_CLIP_DURATIONS: (number | 'full')[] = [20, 30, 45, 60, 'full']
const VALID_TITLE_REVEAL_DELAYS: TitleRevealDelay[] = [0, 5, 10, 15, null]
const VALID_AUDIO_PRESETS: AudioPreset[] = ['hype', 'deadpan', 'minimal']

export function isValidClipDuration(v: unknown): v is number | 'full' {
  return VALID_CLIP_DURATIONS.includes(v as number | 'full')
}
export function isValidTitleRevealDelay(v: unknown): v is TitleRevealDelay {
  return VALID_TITLE_REVEAL_DELAYS.includes(v as TitleRevealDelay)
}
export function isValidAudioPreset(v: unknown): v is AudioPreset {
  return VALID_AUDIO_PRESETS.includes(v as AudioPreset)
}

function isValid(stored: unknown): stored is StoredHostPrefs {
  if (!stored || typeof stored !== 'object') return false
  const s = stored as Record<string, unknown>
  if (s.schemaVersion !== SCHEMA_VERSION) return false
  if (!isValidClipDuration(s.clipDuration)) return false
  if (!isValidTitleRevealDelay(s.titleRevealDelay)) return false
  if (!isValidAudioPreset(s.audioPreset)) return false
  if (typeof s.allowCasualMode !== 'boolean') return false
  if (s.preferredDeviceId !== undefined && typeof s.preferredDeviceId !== 'string') return false
  return true
}

export function readHostPrefs(): HostPrefs | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!isValid(parsed)) return null
  const { clipDuration, titleRevealDelay, audioPreset, allowCasualMode, preferredDeviceId } = parsed
  return { clipDuration, titleRevealDelay, audioPreset, allowCasualMode, preferredDeviceId }
}

export function writeHostPrefs(partial: Partial<HostPrefs>): void {
  if (typeof localStorage === 'undefined') return
  const current = readHostPrefs() ?? {
    clipDuration: 30,
    titleRevealDelay: 10,
    audioPreset: 'minimal' as AudioPreset,
    allowCasualMode: false,
  }
  const next: StoredHostPrefs = {
    schemaVersion: SCHEMA_VERSION,
    ...current,
    ...partial,
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* quota, private mode, etc. */ }
}
