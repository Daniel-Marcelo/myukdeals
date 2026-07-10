/** Thrown on a 401 so callers can bounce the user to /auth instead of showing an empty feed. */
export class AuthError extends Error {}

/**
 * fetch + JSON with real error handling. Checks res.ok, tags 401s as AuthError,
 * and surfaces the server's `{ error }` message when present.
 */
export async function fetchJson<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { cache: 'no-store', ...init })
  if (res.status === 401) throw new AuthError('Unauthorized')
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      // non-JSON error body (e.g. a platform HTML error page) — keep the status message
    }
    throw new Error(msg)
  }
  try {
    return (await res.json()) as T
  } catch {
    return {} as T // e.g. 204 No Content
  }
}
