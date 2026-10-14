"use client"

import { ApiError, errorMessage, unreachable } from "./errors"

// Longer than the Next.js server's own wait for Django, so its clearer error arrives first.
const TIMEOUT_MS = 20_000

/**
 * Calls Django from the browser through /api/backend, which adds the login
 * token from its httpOnly cookie. The token itself never reaches JavaScript.
 * `signal` lets the caller (e.g. TanStack Query) cancel a request nobody needs any more.
 */
export async function request<T>(
  path: string,
  { method = "GET", body, signal }: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`/api/backend/${path.replace(/^\//, "")}`, {
      method,
      headers: { Accept: "application/json", ...(body !== undefined && { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (err) {
    // Cancelled on purpose: pass it on untouched so it isn't shown as an error.
    if (signal?.aborted) throw err
    throw unreachable(timeout.aborted ? timeout.reason : err)
  }
  if (res.status === 401) {
    // A full page load: /logout is a route handler that clears the cookies.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/logout"
    throw new ApiError(401, "Your session has ended. Please log in again.")
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status))
  return data as T
}
