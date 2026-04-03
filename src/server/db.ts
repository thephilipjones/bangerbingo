import Database from 'better-sqlite3'

export interface Host {
  user_id: string
  display_name: string
  email: string
  access_token: string
  refresh_token: string
  token_expires_at: number
}

let db: Database.Database

export function initDb(dbPath = './bangerbingo.db'): void {
  db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS hosts (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at INTEGER NOT NULL
    )
  `)
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

export function getDb(): Database.Database {
  return db
}
