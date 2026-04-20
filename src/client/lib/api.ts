export interface MeResponse {
  user_id: string
  display_name: string
}

export interface RoomSummary {
  code: string
  host_user_id: string
  created_at: number
  host_name: string | null
}

export interface CreateRoomResponse {
  code: string
  url: string
  created_at: number
  host_name: string | null
}

export async function getMe(): Promise<MeResponse | null> {
  const res = await fetch('/api/me')
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`/api/me failed: ${res.status}`)
  return res.json()
}

export async function getRooms(): Promise<RoomSummary[]> {
  const res = await fetch('/api/rooms')
  if (!res.ok) throw new Error(`/api/rooms failed: ${res.status}`)
  return res.json()
}

export async function createRoom(): Promise<CreateRoomResponse> {
  const res = await fetch('/api/rooms', { method: 'POST' })
  if (!res.ok) throw new Error(`POST /api/rooms failed: ${res.status}`)
  return res.json()
}

export async function deleteRoom(code: string): Promise<void> {
  const res = await fetch(`/api/rooms/${code}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /api/rooms/${code} failed: ${res.status}`)
}

export async function logout(): Promise<void> {
  const res = await fetch('/auth/logout', { method: 'POST' })
  if (!res.ok) throw new Error(`POST /auth/logout failed: ${res.status}`)
}

export interface AuthStatusResponse {
  degraded: boolean
  tokenExpiresAt: number
  spotifyConnected: boolean
}

export async function getAuthStatus(): Promise<AuthStatusResponse> {
  const res = await fetch('/api/auth/status')
  if (!res.ok) throw new Error(`/api/auth/status failed: ${res.status}`)
  return res.json()
}

export async function disconnectSpotify(): Promise<void> {
  const res = await fetch('/api/account/spotify/disconnect', { method: 'POST' })
  if (!res.ok) throw new Error(`POST /api/account/spotify/disconnect failed: ${res.status}`)
}

export type AudioPreset = 'hype' | 'deadpan' | 'minimal'

export interface StartRoundPayload {
  playlistId: string
  clipDuration: number | 'full'
  titleRevealDelay: number | null
  hostName?: string
  audioPreset: AudioPreset
  allowCasualMode?: boolean
}

export interface StartRoundResponse {
  roundNumber: number
  playlistId: string
  clipDuration: number | 'full'
  titleRevealDelay: number | null
  audioPreset: AudioPreset
}

export async function startRound(code: string, payload: StartRoundPayload): Promise<StartRoundResponse> {
  const res = await fetch(`/api/rooms/${code}/round`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(err.message ?? 'Request failed')
  }
  return res.json()
}

export async function postStartNextRound(code: string): Promise<Response> {
  return fetch(`/api/rooms/${code}/round/next-round`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export interface RoundConfigPatch {
  clipDuration?: number | 'full'
  titleRevealDelay?: number | null
  audioPreset?: AudioPreset
  allowCasualMode?: boolean
}

export async function patchRoundConfig(code: string, partial: RoundConfigPatch): Promise<Response> {
  return fetch(`/api/rooms/${code}/round-config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  })
}

export interface SpotifyDevice {
  id: string | null
  name: string
  type: string
  is_active: boolean
  is_restricted: boolean
  volume_percent: number | null
}

export async function getDevices(code: string, signal?: AbortSignal): Promise<{ devices: SpotifyDevice[] }> {
  const res = await fetch(`/api/rooms/${code}/player/devices`, { signal })
  if (!res.ok) throw new Error(`GET /player/devices failed: ${res.status}`)
  return res.json()
}

export async function postSetDevice(code: string, deviceId: string): Promise<Response> {
  return fetch(`/api/rooms/${code}/player/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  })
}
