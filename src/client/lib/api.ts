export interface MeResponse {
  user_id: string
  display_name: string
}

export async function getMe(): Promise<MeResponse | null> {
  const res = await fetch('/api/me')
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`/api/me failed: ${res.status}`)
  return res.json()
}
