// Accepts any of the four Spotify playlist URL/URI/ID shapes and returns the
// 22-char Base62 playlist ID, or null if the input is not a recognised shape.
export function extractPlaylistId(input: string): string | null {
  const s = input.trim()

  // spotify:playlist:<id>
  const uriMatch = s.match(/^spotify:playlist:([A-Za-z0-9]{22})(?:\?.*)?$/)
  if (uriMatch) return uriMatch[1]

  // https://open.spotify.com[/<locale>][/embed]/playlist/<id>[?#...]
  const urlMatch = s.match(
    /https?:\/\/open\.spotify\.com\/[^?#]*playlist\/([A-Za-z0-9]{22})(?:[?#].*)?$/,
  )
  if (urlMatch) return urlMatch[1]

  // Bare 22-char Base62 ID
  if (/^[A-Za-z0-9]{22}$/.test(s)) return s

  return null
}
