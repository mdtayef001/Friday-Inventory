"use client"

import { ApiError, errorMessage } from "./errors"

/**
 * Calls Django from the browser through /api/backend, which adds the login
 * token from its httpOnly cookie. The token itself never reaches JavaScript.
 */
export async function request<T>(path: string, { method = "GET", body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/backend/${path.replace(/^\//, "")}`, {
    method,
    headers: { Accept: "application/json", ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  })
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
