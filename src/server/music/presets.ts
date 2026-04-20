export interface Preset {
  name: string
  description: string
  playlistId: string
}

// All presets must be user-curated (non-Spotify-owned) playlists with ≥50 tracks.
// Spotify-owned playlists (IDs starting `37i9dQZF1DX…`) are unreachable under the
// Feb 2026 API scope for individual-dev apps.
export const PRESETS: Preset[] = [
  { name: "Today's Hits", description: 'Current pop radio bangers', playlistId: '5iwkYfnHAGMEFLiHFFGnP4' },
  { name: '80s Pop Hits', description: 'Classic pop hits from the 80s', playlistId: '49PAThhKRCCTXeydvq9uAp' },
  { name: '90s Hits', description: 'The biggest songs of the 90s', playlistId: '3C64V048fGyQfCjmu9TIGA' },
  { name: '2010s Hits', description: 'Summer pop throwbacks of the 2010s', playlistId: '1tPWTwuxOLsE2Do1JQSUxA' },
  { name: 'Rock Anthems', description: 'Guitar-driven crowd pleasers', playlistId: '6g5hmqnr1SH8aNEeDWzwcD' },
  { name: 'Dad Rock', description: '70s classic rock staples', playlistId: '6b2dBnxolvwV2L1L4thWRm' },
  { name: 'Yacht Rock', description: 'Smooth 70s & 80s soft rock', playlistId: '2gzPI2Lxv9Apw5S4Z3CIy2' },
  { name: '80s New Wave', description: 'Synth-pop and new wave essentials', playlistId: '49ZP1Xfm0ZFXvuxtFiuA59' },
  { name: 'Hair Metal', description: '80s glam rock power ballads', playlistId: '7s171XvYrcSuRlzlFfTEyv' },
  { name: '90s Grunge', description: 'Alt rock anthems of the 90s', playlistId: '2KqBLPKtQzrOyDKGWIUYxT' },
  { name: 'Metal Anthems', description: 'Heavy rock and metal classics', playlistId: '16weNrrZuTHZtsOkWqGWWZ' },
  { name: 'Motown Classics', description: 'Motown and soul essentials', playlistId: '70M2GdJysbCKToAuZkWw7a' },
  { name: 'Disco & Funk', description: '70s disco and funk floor-fillers', playlistId: '7d4YzAmg1Cwtkyw98B3Erc' },
  { name: '90s R&B', description: '90s slow jams and R&B classics', playlistId: '3HqCLOOJroddvv6pbOQXRg' },
  { name: '90s Hip-Hop', description: 'Throwback 90s rap classics', playlistId: '1cUJDDYTSqd5LTuImKdrlJ' },
  { name: '2000s Hip-Hop', description: '2000s hip-hop and R&B throwbacks', playlistId: '01pNIDYGqmeawppy32wr3D' },
  { name: 'Pop Punk', description: '2000s pop punk and emo bangers', playlistId: '1jQx9cBFAsfnMV0tckNMQz' },
  { name: 'Indie Rock', description: 'Indie rock anthems', playlistId: '1woGrG1sPrNtgtw7HoBaX2' },
  { name: 'Pop Country', description: 'Pop country crossover hits', playlistId: '23VFN7aXXZ0o27e63wChnh' },
  { name: 'Reggae Vibes', description: 'Bob Marley and reggae classics', playlistId: '1ztK1amCZcm5ackMfGXwAk' },
  { name: 'About to See', description: "Philip's upcoming shows", playlistId: '0peg7lWJ3q0Ai3RHq5rjvx' },
]
