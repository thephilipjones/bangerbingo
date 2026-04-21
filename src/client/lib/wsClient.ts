// WebSocket client with heartbeat awareness, exponential-backoff reconnect,
// and explicit state machine. See story 12-1 for acceptance criteria.

export type WsState = 'connecting' | 'open' | 'reconnecting' | 'dead'

const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000] as const
const MAX_CONSECUTIVE_FAILURES = 5
const PING_WATCHDOG_TIMEOUT_MS = 45_000
const WATCHDOG_CHECK_INTERVAL_MS = 5_000
// Matches server's HEARTBEAT_INTERVAL_MS — anything older than one ping
// interval is suspicious enough to force-close on resume (see nudge()).
const STALE_ON_RESUME_MS = 20_000

export function computeBackoffDelay(failureIdx: number): number {
  const clamped = Math.max(0, Math.min(failureIdx, BACKOFF_DELAYS_MS.length - 1))
  return BACKOFF_DELAYS_MS[clamped]
}

export interface WsClientOptions {
  url: string
  onMessage: (data: unknown) => void
  onStateChange?: (state: WsState) => void
  // Adopt an already-created socket (used by guest flow where JoinPage opens
  // the initial socket for validation, then hands it off to RoomPage).
  existingSocket?: WebSocket
  // Injectable dependencies (tests)
  now?: () => number
  WebSocketCtor?: typeof WebSocket
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

export interface WsClient {
  getState(): WsState
  send(data: string | object): void
  nudge(): void
  onResume(cb: () => void): () => void
  close(): void
}

export function createWsClient(opts: WsClientOptions): WsClient {
  const {
    url,
    onMessage,
    onStateChange,
    existingSocket,
    now = () => Date.now(),
    WebSocketCtor = (typeof WebSocket !== 'undefined' ? WebSocket : undefined) as typeof WebSocket,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = opts

  let state: WsState = 'connecting'
  let ws: WebSocket | null = null
  let failures = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setInterval> | undefined
  let lastPingAt = now()
  let thisAttemptReachedOpen = false
  let openedAtLeastOnce = false
  let disposed = false
  const resumeListeners = new Set<() => void>()

  function setState(next: WsState) {
    if (state === next) return
    state = next
    try { onStateChange?.(state) } catch { /* ignore */ }
  }

  function fireResume() {
    for (const cb of Array.from(resumeListeners)) {
      try { cb() } catch { /* ignore */ }
    }
  }

  function attachSocket(sock: WebSocket, alreadyOpen: boolean) {
    ws = sock
    thisAttemptReachedOpen = alreadyOpen

    const onOpen = () => {
      if (disposed || ws !== sock) return
      failures = 0
      thisAttemptReachedOpen = true
      lastPingAt = now()
      const wasReconnect = openedAtLeastOnce && state !== 'open'
      openedAtLeastOnce = true
      setState('open')
      if (wasReconnect) fireResume()
    }

    const onClose = (ev: { code: number } | CloseEvent) => {
      if (disposed || ws !== sock) return
      ws = null
      const code = (ev as { code: number }).code
      // 1000 is reserved for intentional normal closure (session:end,
      // navigation, manual client.close()). Do NOT reconnect.
      // 4xxx are application-defined codes (unauthorized, room-not-found,
      // name-taken, …). Retrying cannot fix these — go straight to dead so
      // the UI surfaces the refresh banner instead of burning ~31s of retries.
      if (code === 1000 || (code >= 4000 && code < 5000)) {
        setState('dead')
        stopWatchdog()
        return
      }
      if (!thisAttemptReachedOpen) {
        failures++
      } else {
        // Previously open; count this as the first failure of a new streak.
        failures = 1
      }
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        setState('dead')
        stopWatchdog()
        return
      }
      setState('reconnecting')
      scheduleRetry()
    }

    const onError = () => {
      // Let close drive state — some environments fire error without close.
    }

    const onMsg = (event: MessageEvent) => {
      if (disposed || ws !== sock) return
      lastPingAt = now()
      let parsed: unknown
      try { parsed = JSON.parse(String(event.data)) } catch { return }
      if (parsed && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'ping') {
        const t = (parsed as { t?: number }).t
        try { sock.send(JSON.stringify({ type: 'pong', t })) } catch { /* ignore */ }
        return
      }
      onMessage(parsed)
    }

    sock.addEventListener('open', onOpen)
    sock.addEventListener('close', onClose as EventListener)
    sock.addEventListener('error', onError)
    sock.addEventListener('message', onMsg as EventListener)
  }

  function scheduleRetry() {
    if (retryTimer) clearTimeoutFn(retryTimer)
    const delay = computeBackoffDelay(failures - 1)
    retryTimer = setTimeoutFn(() => {
      retryTimer = undefined
      if (disposed) return
      tryConnect()
    }, delay)
  }

  function tryConnect() {
    if (disposed) return
    try {
      const sock = new WebSocketCtor(url)
      attachSocket(sock, false)
    } catch {
      failures++
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        setState('dead')
      } else {
        setState('reconnecting')
        scheduleRetry()
      }
    }
  }

  function startWatchdog() {
    if (watchdog) return
    watchdog = setIntervalFn(() => {
      if (disposed) return
      if (state !== 'open' || !ws) return
      if (now() - lastPingAt > PING_WATCHDOG_TIMEOUT_MS) {
        try { ws.close() } catch { /* ignore */ }
      }
    }, WATCHDOG_CHECK_INTERVAL_MS)
  }

  function stopWatchdog() {
    if (watchdog) {
      clearIntervalFn(watchdog)
      watchdog = undefined
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  if (existingSocket) {
    const alreadyOpen = existingSocket.readyState === 1 /* OPEN */
    if (alreadyOpen) {
      failures = 0
      lastPingAt = now()
      openedAtLeastOnce = true
      setState('open')
    } else {
      setState('connecting')
    }
    attachSocket(existingSocket, alreadyOpen)
  } else {
    setState('connecting')
    tryConnect()
  }
  startWatchdog()

  return {
    getState: () => state,
    send(data) {
      if (state !== 'open' || !ws) return
      const payload = typeof data === 'string' ? data : JSON.stringify(data)
      try { ws.send(payload) } catch { /* ignore */ }
    },
    nudge() {
      // iOS Safari resume: the socket's readyState often still reports OPEN
      // for a second or two after a long background-suspend, so nudge() on
      // `visibilitychange` would no-op and the page would wait for the next
      // heartbeat to detect the dead connection. If lastPingAt is stale
      // (server normally pings every 20s), force-close the socket to enter
      // the reconnect branch immediately.
      if (state === 'open') {
        if (ws && now() - lastPingAt > STALE_ON_RESUME_MS) {
          try { ws.close() } catch { /* ignore */ }
        }
        return
      }
      if (retryTimer) {
        clearTimeoutFn(retryTimer)
        retryTimer = undefined
      }
      failures = 0
      if (ws && ws.readyState !== 3 /* CLOSED */) {
        try { ws.close() } catch { /* ignore */ }
      }
      ws = null
      setState('reconnecting')
      tryConnect()
    },
    onResume(cb) {
      resumeListeners.add(cb)
      return () => { resumeListeners.delete(cb) }
    },
    close() {
      if (disposed) return
      disposed = true
      if (retryTimer) {
        clearTimeoutFn(retryTimer)
        retryTimer = undefined
      }
      stopWatchdog()
      if (ws && ws.readyState !== 3 /* CLOSED */) {
        try { ws.close(1000, 'client_close') } catch { /* ignore */ }
      }
      ws = null
      setState('dead')
    },
  }
}
