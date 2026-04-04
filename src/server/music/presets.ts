export interface Preset {
  name: string
  description: string
  playlistId: string
}

export const PRESETS: Preset[] = [
  { name: '80s Pop', description: 'Classic pop hits from the 80s', playlistId: '37i9dQZF1DXb57FjYWz00c' },
  { name: '90s Hits', description: 'The biggest songs of the 90s', playlistId: '37i9dQZF1DXbTxeAdrVG2l' },
  { name: '00s Bangers', description: 'Peak 2000s pop and RnB', playlistId: '37i9dQZF1DX4o1oenSJRJd' },
  { name: 'Pop Classics', description: 'Essential pop anthems', playlistId: '37i9dQZF1DXcBWIGoYBM5M' },
  { name: 'Rock Anthems', description: 'Guitar-driven crowd pleasers', playlistId: '37i9dQZF1DXcF6B6QPhFDv' },
  { name: 'Party Hits', description: 'Floor-fillers across all eras', playlistId: '37i9dQZF1DXdPec7aLTmlC' },
]
