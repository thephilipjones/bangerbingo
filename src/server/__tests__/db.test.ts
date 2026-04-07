import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb, upsertHost, getHostById, getDb, createRoom, setRoomHostName, upsertActiveRoom, deleteActiveRoom, getAllActiveRooms } from '../db.ts'

describe('db', () => {
  beforeEach(() => {
    // Use in-memory DB for each test
    initDb(':memory:')
  })

  describe('upsertHost', () => {
    it('inserts a new host', () => {
      upsertHost({
        user_id: 'user123',
        display_name: 'Test User',
        email: 'test@example.com',
        access_token: 'access_abc',
        refresh_token: 'refresh_xyz',
        token_expires_at: Date.now() + 3600_000,
      })

      const host = getHostById('user123')
      expect(host).toBeDefined()
      expect(host!.display_name).toBe('Test User')
      expect(host!.email).toBe('test@example.com')
    })

    it('updates existing host on conflict', () => {
      const base = {
        user_id: 'user123',
        display_name: 'Old Name',
        email: 'old@example.com',
        access_token: 'old_access',
        refresh_token: 'old_refresh',
        token_expires_at: 1000,
      }
      upsertHost(base)
      upsertHost({ ...base, display_name: 'New Name', access_token: 'new_access', token_expires_at: 9999 })

      const host = getHostById('user123')
      expect(host!.display_name).toBe('New Name')
      expect(host!.access_token).toBe('new_access')
      expect(host!.token_expires_at).toBe(9999)
    })
  })

  describe('getHostById', () => {
    it('returns undefined for unknown user', () => {
      expect(getHostById('nonexistent')).toBeUndefined()
    })
  })

  describe('rooms.host_name', () => {
    it('includes host_name column on fresh db (NULL at creation)', () => {
      upsertHost({
        user_id: 'h1',
        display_name: 'H',
        email: 'h@e.com',
        access_token: 'a',
        refresh_token: 'r',
        token_expires_at: Date.now() + 3600_000,
      })
      const room = createRoom('ABCD', 'h1')
      expect(room.host_name).toBeNull()

      const row = getDb().prepare('SELECT * FROM rooms WHERE code = ?').get('ABCD') as { host_name: string | null }
      expect(row.host_name).toBeNull()
    })

    it('setRoomHostName persists value', () => {
      upsertHost({
        user_id: 'h1',
        display_name: 'H',
        email: 'h@e.com',
        access_token: 'a',
        refresh_token: 'r',
        token_expires_at: Date.now() + 3600_000,
      })
      createRoom('ABCD', 'h1')
      setRoomHostName('ABCD', 'Sarah')
      const row = getDb().prepare('SELECT host_name FROM rooms WHERE code = ?').get('ABCD') as { host_name: string | null }
      expect(row.host_name).toBe('Sarah')
    })
  })
})

describe('active_rooms', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  it('active_rooms table is created by initDb', () => {
    const tables = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='active_rooms'").all()
    expect(tables).toHaveLength(1)
  })

  it('upsertActiveRoom inserts and getAllActiveRooms retrieves', () => {
    upsertActiveRoom('ABCD', '{"test":true}')
    const rows = getAllActiveRooms()
    expect(rows).toHaveLength(1)
    expect(rows[0].room_code).toBe('ABCD')
    expect(rows[0].state_json).toBe('{"test":true}')
  })

  it('upsertActiveRoom updates existing row on conflict', () => {
    upsertActiveRoom('ABCD', '{"v":1}')
    upsertActiveRoom('ABCD', '{"v":2}')
    const rows = getAllActiveRooms()
    expect(rows).toHaveLength(1)
    expect(rows[0].state_json).toBe('{"v":2}')
  })

  it('deleteActiveRoom removes the row', () => {
    upsertActiveRoom('ABCD', '{"test":true}')
    deleteActiveRoom('ABCD')
    expect(getAllActiveRooms()).toHaveLength(0)
  })

  it('deleteActiveRoom is a no-op for missing row', () => {
    expect(() => deleteActiveRoom('ZZZZ')).not.toThrow()
  })

  it('getAllActiveRooms returns multiple rows', () => {
    upsertActiveRoom('AAAA', '{"a":1}')
    upsertActiveRoom('BBBB', '{"b":2}')
    expect(getAllActiveRooms()).toHaveLength(2)
  })
})

describe('initDb migration for host_name column', () => {
  it('adds host_name column to a pre-existing rooms table missing the column', async () => {
    // Simulate a pre-migration database: open a file-backed sqlite, create the old-shape
    // rooms table (without host_name), then invoke initDb() against the same path.
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const tmpPath = path.join(os.tmpdir(), `bb-migration-test-${Date.now()}-${Math.random()}.db`)
    try {
      const seedDb = new Database(tmpPath)
      seedDb.exec(`
        CREATE TABLE hosts (
          user_id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          email TEXT NOT NULL,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          token_expires_at INTEGER NOT NULL
        );
        CREATE TABLE rooms (
          code TEXT PRIMARY KEY,
          host_user_id TEXT NOT NULL REFERENCES hosts(user_id),
          created_at INTEGER NOT NULL
        );
      `)
      const preCols = seedDb.prepare('PRAGMA table_info(rooms)').all() as Array<{ name: string }>
      expect(preCols.some(c => c.name === 'host_name')).toBe(false)
      seedDb.close()

      // Should not throw
      expect(() => initDb(tmpPath)).not.toThrow()

      const postCols = getDb().prepare('PRAGMA table_info(rooms)').all() as Array<{ name: string }>
      expect(postCols.some(c => c.name === 'host_name')).toBe(true)
    } finally {
      // Close the handle the migration opened before unlinking the file, then restore
      // the in-memory DB so sibling test suites in this worker don't see the tmp handle.
      try { getDb()?.close() } catch { /* ignore */ }
      try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
      try { fs.unlinkSync(tmpPath + '-wal') } catch { /* ignore */ }
      try { fs.unlinkSync(tmpPath + '-shm') } catch { /* ignore */ }
      initDb(':memory:')
    }
  })
})
