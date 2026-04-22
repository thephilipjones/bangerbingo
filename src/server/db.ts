import Database from 'better-sqlite3'

export interface Host {
  user_id: string
  display_name: string
  email: string
  access_token: string
  refresh_token: string
  token_expires_at: number
}

export interface Room {
  code: string
  host_user_id: string
  created_at: number // Unix ms timestamp
  host_name: string | null
}

let db: Database.Database

export function initDb(dbPath = './bangerbingo.db'): void {
  db = new Database(dbPath)
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS hosts (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      host_user_id TEXT NOT NULL REFERENCES hosts(user_id),
      created_at INTEGER NOT NULL,
      host_name TEXT
    );
    CREATE TABLE IF NOT EXISTS played_songs (
      room_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, track_id)
    );
    CREATE TABLE IF NOT EXISTS active_rooms (
      room_code TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  // Idempotent migration: ensure `host_name` column exists on pre-existing databases
  // where the `rooms` table was created before the column was added.
  const cols = db.prepare("PRAGMA table_info(rooms)").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'host_name')) {
    db.exec('ALTER TABLE rooms ADD COLUMN host_name TEXT')
  }
}

export function upsertHost(host: Host): void {
  db.prepare(`
    INSERT INTO hosts (user_id, display_name, email, access_token, refresh_token, token_expires_at)
    VALUES (@user_id, @display_name, @email, @access_token, @refresh_token, @token_expires_at)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name = excluded.display_name,
      email = excluded.email,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expires_at = excluded.token_expires_at
  `).run(host)
}

export function getHostById(userId: string): Host | undefined {
  return db.prepare('SELECT * FROM hosts WHERE user_id = ?').get(userId) as Host | undefined
}

export function updateHostTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number
): void {
  const result = db.prepare(`
    UPDATE hosts SET
      access_token = ?,
      refresh_token = ?,
      token_expires_at = ?
    WHERE user_id = ?
  `).run(accessToken, refreshToken, expiresAt, userId)
  if (result.changes === 0) throw new Error(`updateHostTokens: no host found for userId ${userId}`)
}

export function clearHostTokens(userId: string): void {
  const result = db.prepare(`
    UPDATE hosts SET
      access_token = '',
      refresh_token = '',
      token_expires_at = 0
    WHERE user_id = ?
  `).run(userId)
  if (result.changes === 0) throw new Error(`clearHostTokens: no host found for userId ${userId}`)
}

export function getAllHosts(): Host[] {
  return db.prepare('SELECT * FROM hosts').all() as Host[]
}

export function getDb(): Database.Database {
  return db
}

export function createRoom(code: string, hostUserId: string): Room {
  const created_at = Date.now()
  db.prepare('INSERT INTO rooms (code, host_user_id, created_at) VALUES (?, ?, ?)').run(code, hostUserId, created_at)
  return { code, host_user_id: hostUserId, created_at, host_name: null }
}

export function setRoomHostName(code: string, hostName: string): void {
  db.prepare('UPDATE rooms SET host_name = ? WHERE code = ?').run(hostName, code)
}

export function getRoomsByHost(hostUserId: string): Room[] {
  return db.prepare('SELECT * FROM rooms WHERE host_user_id = ? ORDER BY created_at DESC').all(hostUserId) as Room[]
}

export function getRoomByCode(code: string): Room | undefined {
  return db.prepare('SELECT * FROM rooms WHERE code = ?').get(code) as Room | undefined
}

export function getPlayedSongs(roomId: string): string[] {
  return (db.prepare('SELECT track_id FROM played_songs WHERE room_id = ?').all(roomId) as Array<{ track_id: string }>)
    .map(r => r.track_id)
}

export function deleteRoom(code: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM played_songs WHERE room_id = ?').run(code)
    db.prepare('DELETE FROM rooms WHERE code = ?').run(code)
  })()
}

export function recordPlayedSongs(roomId: string, trackIds: string[]): void {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO played_songs (room_id, track_id, played_at) VALUES (?, ?, ?)'
  )
  const now = Date.now()
  for (const trackId of trackIds) {
    stmt.run(roomId, trackId, now)
  }
}

export function clearPlayedSongs(roomId: string): void {
  db.prepare('DELETE FROM played_songs WHERE room_id = ?').run(roomId)
}

export function upsertActiveRoom(code: string, stateJson: string): void {
  db.prepare(`
    INSERT INTO active_rooms (room_code, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(room_code) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).run(code, stateJson, Date.now())
}

export function deleteActiveRoom(code: string): void {
  db.prepare('DELETE FROM active_rooms WHERE room_code = ?').run(code)
}

export function getAllActiveRooms(): Array<{ room_code: string; state_json: string }> {
  return db.prepare('SELECT room_code, state_json FROM active_rooms').all() as Array<{ room_code: string; state_json: string }>
}
