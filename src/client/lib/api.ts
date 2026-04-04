export interface MeResponse {
  user_id: string
  display_name: string
}

export interface RoomSummary {
  code: string
  host_user_id: string
  created_at: number
}

export interface CreateRoomResponse {
  code: string
  url: string
  created_at: number
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

export interface StartRoundPayload {
  playlistId: string
  clipDuration: number | 'full'
  titleRevealDelay: number | null
}

export interface StartRoundResponse {
  roundNumber: number
  playlistId: string
  clipDuration: number | 'full'
  titleRevealDelay: number | null
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
