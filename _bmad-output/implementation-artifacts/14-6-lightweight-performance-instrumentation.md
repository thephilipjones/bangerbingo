# Story 14-6: Lightweight Performance Instrumentation

## Status: ready-for-dev

## Context

Actual felt performance is snappy — no user complaints — so this isn't a pain point. It's a breadcrumb: if perceived perf ever degrades during a game night, there's a server-side number to check instead of guessing.

Deliberately narrow: **server-side latency of the two hottest backend paths only** (WebSocket broadcast dispatch, Spotify API calls), plus the Start Round end-to-end handler time. That's what this story covers and nothing more. A tiny in-memory sample buffer, a single authenticated `/api/metrics` JSON endpoint. No client-side telemetry (user-perceived control response lives in the browser — if ever needed, separate story). No session-lifetime / memory tracking (NFR4 stability is a different shape of measurement — also separate story). No load-test rig (NFR5 responsiveness under N clients — also separate). No Prometheus, no log pipeline, no alerting.

Scope claim: this story helps triangulate **parts of NFR2 (200ms WS broadcast)** and **NFR3 (2s card load)**. It does **not** close NFR1, NFR4, or NFR5 — those would need client-side, long-running, or load-testing instrumentation respectively.

## Story

As the **operator / sole developer**,
I want **a small, zero-dependency in-memory metrics surface for the two hottest server-side paths (WS broadcast, Spotify API calls) plus the Start Round flow**,
so that **if the app ever feels slow, I can check a number instead of guessing — scoped tightly to what's cheap to measure server-side**.

## Acceptance Criteria

**AC-1 — Instrument WS broadcast latency.**
In [src/server/ws.ts](src/server/ws.ts) `broadcast(code, msg)`, wrap the per-socket send loop with `performance.now()` start/end. Record total elapsed time for the broadcast (not per-socket). Store as a sample in the metrics buffer keyed `ws.broadcast.<type>` where `<type>` is the message `type` field.

**AC-2 — Instrument Spotify API call duration.**
Around each `fetch` to `api.spotify.com` (there are ~4–5 sites: token refresh, search, tracks, resume, transfer), wrap with `performance.now()` and record as `spotify.<endpoint>`. Use a small helper — one wrapper function — so the wrapping is 3 lines per call site, not 10.

**AC-3 — Instrument `/api/rooms/:code/round` Start Round end-to-end.**
The full flow from request receipt to first `round:start` broadcast dispatch. Captures the heaviest happy-path operation. Recorded as `round.start.total`.

**AC-4 — In-memory ring buffer, bounded.**
Metrics helper maintains a `Map<string, { count: number; totalMs: number; maxMs: number; recentMs: number[] }>` where `recentMs` is a FIFO buffer of the last 100 samples per key. No disk writes, no external sinks, no global accumulation beyond the per-key cap.

**AC-5 — `GET /api/metrics` endpoint.**
New endpoint, `requireAuth`-gated (only authenticated hosts can read). Returns JSON:
```json
{
  "since": "2026-04-23T18:30:00.000Z",
  "samples": {
    "ws.broadcast.song:start": { "count": 142, "avgMs": 4.2, "p95Ms": 9.1, "maxMs": 18.3 },
    "spotify.search": { "count": 3, "avgMs": 180, "p95Ms": 240, "maxMs": 240 },
    "round.start.total": { "count": 4, "avgMs": 410, "p95Ms": 520, "maxMs": 520 }
  }
}
```
`p95` computed from the `recentMs` buffer; `avg` computed from `totalMs / count` (all-time mean). `since` is server start time.

**AC-6 — No perceptible overhead.**
The instrumentation must add < 1ms overhead per broadcast at p95. `performance.now()` is sub-microsecond; the only real cost is the map lookup + array push. Verify by sanity: wrapping 1000 broadcasts in a hot loop in a dev test adds <10ms total.

**AC-7 — No client-side instrumentation.**
No browser-side timers, no `performance.measure`, no web-vitals, no POSTs back to the server. Server-side only. If client perf ever needs measurement, that's a different story.

**AC-8 — Docs.**
One paragraph in README (or a new `docs/observability.md`, author's call) describing `/api/metrics`, what it measures **and what it does not measure** (explicitly: no client-side timing, no session-lifetime tracking, no load-test coverage). No dashboard, no grafana. The value here is "I can curl it after game night."

## Implementation Sketch

**New file: [src/server/metrics.ts](src/server/metrics.ts)** — tiny module (~40 lines):
```ts
const samples = new Map<string, { count: number; totalMs: number; maxMs: number; recent: number[] }>()
const started = new Date().toISOString()

export function record(key: string, ms: number): void {
  const s = samples.get(key) ?? { count: 0, totalMs: 0, maxMs: 0, recent: [] }
  s.count++
  s.totalMs += ms
  s.maxMs = Math.max(s.maxMs, ms)
  s.recent.push(ms)
  if (s.recent.length > 100) s.recent.shift()
  samples.set(key, s)
}

export function time<T>(key: string, fn: () => T): T {
  const t0 = performance.now()
  try { return fn() } finally { record(key, performance.now() - t0) }
}

export async function timeAsync<T>(key: string, fn: () => Promise<T>): Promise<T> { ... }

export function snapshot(): { since: string; samples: Record<string, ...> } { ... }
```

**Wrapping sites:**
- `broadcast()` in [src/server/ws.ts](src/server/ws.ts) — `time(`ws.broadcast.${msg.type}`, () => ...)`
- Spotify fetches in [src/server/music/spotify.ts](src/server/music/spotify.ts), [src/server/auth.ts](src/server/auth.ts), [src/server/rooms.ts](src/server/rooms.ts) — wrap each with `timeAsync('spotify.<name>', () => fetch(...))`
- POST `/round` handler in [src/server/rooms.ts](src/server/rooms.ts) — wrap the handler body with `timeAsync('round.start.total', ...)` or mark start/end explicitly since the broadcast is async after response

**New endpoint:** `GET /api/metrics` in [src/server/rooms.ts](src/server/rooms.ts) or a new route file — calls `snapshot()`, returns JSON, `requireAuth` middleware.

## Defer / Out of Scope

- Histograms, Prometheus exposition format, StatsD, OpenTelemetry — all over-engineering for the scale.
- Alerting, threshold checks — operator runs `curl` by hand.
- Per-request tracing IDs — not needed for a friends-only app.
- Retention beyond 100 recent samples per key.
- Frontend (client) perf measurement — separate story if ever needed.
- Load-testing harness — different effort entirely.

## References

- `_bmad-output/prd.md` NFR2 (200ms WS broadcast) + NFR3 (2s card load) — partial coverage only; NFR1/NFR4/NFR5 intentionally out of scope
- [src/server/ws.ts](src/server/ws.ts) — `broadcast` function (main instrumentation site)
- [src/server/music/spotify.ts](src/server/music/spotify.ts) — Spotify fetch call sites
- [src/server/rooms.ts](src/server/rooms.ts) — `/round` handler + broadcast dispatch
- Deferred from project-review-vs-directional-docs (2026-04-05): *"NFR1–NFR5 performance targets unverified"*
