import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, upsertHost, getHostById } from '../db.ts'

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
})
