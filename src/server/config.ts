const required = (name: string): string => {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required environment variable: ${name}`)
  return val
}

export const config = {
  spotifyClientId: required('SPOTIFY_CLIENT_ID'),
  spotifyClientSecret: process.env['SPOTIFY_CLIENT_SECRET'] ?? '',
  spotifyRedirectUri: required('SPOTIFY_REDIRECT_URI'),
  sessionSecret: required('SESSION_SECRET'),
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  isProduction: process.env['NODE_ENV'] === 'production',
} as const
