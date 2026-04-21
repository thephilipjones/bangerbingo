// Mobile-host heuristic. When true, skip loading the Spotify Web Playback SDK
// (iOS Safari + Chrome Android support is unreliable) and rely on the user's
// Spotify app as the default Connect target. Story 12-2 AC #1.
//
// UA sniffing is deliberately permissive — this only sets the *default* path;
// the device picker remains fully available for manual override (AC #4). Edge
// cases (tablet with keyboard, etc.) are acceptable false positives because
// the user can still pick any device.
export function isMobileHost(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return true
  // iPadOS 13+ reports a desktop UA (Macintosh; Intel Mac OS X) but still exposes
  // touch points — treat a MacIntel device with multi-touch as mobile.
  if (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1) return true
  return (navigator.maxTouchPoints ?? 0) > 1 && window.innerWidth < 900
}
