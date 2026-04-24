// ── Error types ────────────────────────────────────────────────────────────

export class SpotifyApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'SpotifyApiError'
  }
}

export class InsufficientTracksError extends Error {
  constructor(public count: number) {
    super(`This playlist doesn't have enough tracks — need at least 25`)
    this.name = 'InsufficientTracksError'
  }
}

// ── Track interface (reused by Story 4-3) ─────────────────────────────────

export interface Track {
  id: string
  title: string
  artist: string
  albumArtUrl: string
  durationMs: number
}

// ── Spotify response shapes ────────────────────────────────────────────────

interface SpotifySearchResponse {
  playlists: {
    next: string | null
    items: Array<{
      id: string
      name: string
      owner: { display_name: string; id: string }
      tracks: { total: number }
    }>
  }
}

interface SpotifyTracksResponse {
  items: Array<{
    track: {
      id: string
      name: string
      artists: Array<{ name: string }>
      album: { images: Array<{ url: string }> }
      duration_ms: number
    } | null
  }>
}

// ── Spotify helpers ────────────────────────────────────────────────────────

export interface PlaylistResult {
  name: string
  owner: string
  trackCount: number
  playlistId: string
}

export interface SearchPlaylistsResponse {
  results: PlaylistResult[]
  hasMore: boolean
}

export async function searchPlaylists(
  query: string,
  accessToken: string,
  offset = 0,
): Promise<SearchPlaylistsResponse> {
  const url = new URL('https://api.spotify.com/v1/search')
  url.searchParams.set('type', 'playlist')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '10')
  url.searchParams.set('offset', String(offset))

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) throw new SpotifyApiError(res.status, await res.text())

  const data = await res.json() as SpotifySearchResponse

  const results = (data.playlists?.items ?? []).filter(item => item !== null).map(item => ({
    name: item.name,
    owner: item.owner.display_name ?? item.owner.id,
    trackCount: item.tracks.total,
    playlistId: item.id,
  }))

  return { results, hasMore: data.playlists?.next != null }
}

interface SpotifyPlaylistMetaResponse {
  name: string
  owner: { display_name?: string; id: string }
  tracks: { total: number }
}

export async function getPlaylistMeta(
  playlistId: string,
  accessToken: string,
): Promise<{ name: string; owner: string; trackCount: number }> {
  const url = new URL(`https://api.spotify.com/v1/playlists/${playlistId}`)
  url.searchParams.set('fields', 'name,owner(display_name,id),tracks(total)')
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new SpotifyApiError(res.status, await res.text())
  const data = await res.json() as SpotifyPlaylistMetaResponse
  return {
    name: data.name,
    owner: data.owner.display_name ?? data.owner.id,
    trackCount: data.tracks.total,
  }
}

export async function getPlaylistTracks(playlistId: string, accessToken: string): Promise<Track[]> {
  const url = new URL(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`)
  url.searchParams.set('limit', '100')
  url.searchParams.set('fields', 'items(track(id,name,artists,album(images),duration_ms))')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) throw new SpotifyApiError(res.status, await res.text())

  const data = await res.json() as SpotifyTracksResponse

  // Dedupe by track ID first (same entry added twice), then by normalised
  // title+artist so different versions of the same song (album vs. live, same
  // name/artist but different IDs) don't both land on a card as look-alike tiles.
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  const tracks = data.items
    .filter(item => item.track && item.track.id)
    .filter(item => {
      if (seenIds.has(item.track!.id)) return false
      seenIds.add(item.track!.id)
      const nameKey = `${item.track!.name.toLowerCase()}|${(item.track!.artists?.[0]?.name ?? '').toLowerCase()}`
      if (seenNames.has(nameKey)) return false
      seenNames.add(nameKey)
      return true
    })
    .map(item => ({
      id: item.track!.id,
      title: item.track!.name,
      artist: item.track!.artists?.[0]?.name ?? 'Unknown',
      albumArtUrl: item.track!.album.images[0]?.url ?? '',
      durationMs: item.track!.duration_ms ?? 180_000,
    }))

  if (tracks.length < 25) throw new InsufficientTracksError(tracks.length)

  return tracks
}
