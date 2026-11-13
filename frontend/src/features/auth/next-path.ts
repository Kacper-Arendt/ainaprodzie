/**
 * The `next` query parameter is attacker-controlled. It is resolved the way
 * the browser would resolve it, so whatever the URL parser does to it
 * (`//host`, `/\host`, a stripped tab or newline) is already applied, and
 * only a target on this origin survives; anything else goes home.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/')) return '/'
  let url: URL
  try {
    url = new URL(raw, window.location.origin)
  } catch {
    // An unparseable authority, such as `//host:99999999`.
    return '/'
  }
  if (url.origin !== window.location.origin) return '/'
  return url.pathname + url.search + url.hash
}
