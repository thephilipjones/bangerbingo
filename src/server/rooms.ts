import { Hono } from 'hono'
import crypto from 'node:crypto'
import { createRoom, getRoomsByHost, getRoomByCode, type Room } from './db.ts'
import { requireAuth, type AuthEnv } from './auth.ts'
import { roomSockets, type RoundConfig, type ClipDuration, type TitleRevealDelay } from './ws.ts'

// ── Room code generation ───────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // 24 chars: A-Z minus O and I

export function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)]
  }
  return code
}

export function createRoomWithRetry(
  hostUserId: string,
  codeGen: () => string = generateRoomCode
): Room {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = codeGen()
    try {
      return createRoom(code, hostUserId)
    } catch (err: unknown) {
      // UNIQUE constraint violation — retry
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        continue
      }
      throw err
    }
  }
  throw new Error('Failed to generate unique room code after 10 attempts')
}

// ── Rooms router ───────────────────────────────────────────────────────────

export const roomsRouter = new Hono<AuthEnv>()

roomsRouter.post('/rooms', requireAuth, (ctx) => {
  const host = ctx.var.host
  try {
    const room = createRoomWithRetry(host.user_id)
    return ctx.json({ code: room.code, url: `/room/${room.code}`, created_at: room.created_at })
  } catch (err) {
    return ctx.json({ error: 'Failed to generate unique room code' }, 500)
  }
})

roomsRouter.get('/rooms', requireAuth, (ctx) => {
  const host = ctx.var.host
  const rooms = getRoomsByHost(host.user_id)
  return ctx.json(rooms)
})

// ── Round config ───────────────────────────────────────────────────────────

const VALID_CLIP_DURATIONS: ClipDuration[] = [20, 30, 45, 60, 'full']
const VALID_TITLE_REVEAL_DELAYS: TitleRevealDelay[] = [0, 5, 10, 15, null]

roomsRouter.post('/rooms/:code/round', requireAuth, async (ctx) => {
  const host = ctx.var.host
  const code = ctx.req.param('code')

  const room = getRoomByCode(code)
  if (!room) return ctx.json({ message: 'Room not found' }, 404)
  if (room.host_user_id !== host.user_id) return ctx.json({ message: 'Forbidden' }, 403)

  const body = await ctx.req.json().catch(() => null)
  if (!body) return ctx.json({ message: 'Invalid request body' }, 400)

  const { playlistId, clipDuration, titleRevealDelay } = body

  if (!playlistId || typeof playlistId !== 'string' || !playlistId.trim())
    return ctx.json({ message: 'playlistId is required' }, 400)
  if (!VALID_CLIP_DURATIONS.includes(clipDuration))
    return ctx.json({ message: 'Invalid clipDuration' }, 400)
  if (!VALID_TITLE_REVEAL_DELAYS.includes(titleRevealDelay))
    return ctx.json({ message: 'Invalid titleRevealDelay' }, 400)

  const roomState = roomSockets.get(code)
  const roundNumber = roomState?.pendingRound ? roomState.pendingRound.roundNumber + 1 : 1

  const roundConfig: RoundConfig = { playlistId, clipDuration, titleRevealDelay, roundNumber }

  if (roomState) {
    roomState.pendingRound = roundConfig
  }

  return ctx.json(roundConfig)
})
