import { Hono } from 'hono'
import crypto from 'node:crypto'
import { createRoom, getRoomsByHost, type Room } from './db.ts'
import { requireAuth, type AuthEnv } from './auth.ts'

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
