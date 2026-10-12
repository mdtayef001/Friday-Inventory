import "server-only"
import { jwtVerify } from "jose"
import { cookies } from "next/headers"
import { API_URL } from "@/lib/api/config"
import type { Role } from "@/lib/types"

// Login tokens come from Django (SimpleJWT) and live in httpOnly cookies, so
// browser JavaScript never sees them. The access token is short-lived;
// proxy.ts swaps in a new one using the refresh token when it runs out.

export const ACCESS_COOKIE = "friday_access"
export const REFRESH_COOKIE = "friday_refresh"
// Match ACCESS_TOKEN_LIFETIME and REFRESH_TOKEN_LIFETIME in backend/config/settings.py.
const ACCESS_SECONDS = 15 * 60
const REFRESH_SECONDS = 12 * 60 * 60
const ROLES: Role[] = ["superadmin", "owner", "manager", "staff"]

export interface SessionPayload {
  userId: string
  role: Role
  tenantId: string | null
}

export interface Tokens {
  access: string
  refresh?: string
}

function key() {
  const secret = process.env.JWT_SIGNING_KEY
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SIGNING_KEY must be set to the same value as in backend/.env (see .env.example)")
  }
  return new TextEncoder().encode(secret)
}

/** Checks the signature and expiry. Used for fast routing only; Django re-checks every API call. */
export async function verifyAccess(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] })
    if (payload.token_type !== "access" || !ROLES.includes(payload.role as Role)) return null
    return { userId: String(payload.user_id), role: payload.role as Role, tenantId: (payload.tenant_id as string | null) ?? null }
  } catch {
    return null
  }
}

/** Trades a refresh token for a new access token. Null when the login has ended or was logged out. */
export async function refreshAccess(refresh: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
      cache: "no-store",
    })
    if (!res.ok) return null
    const data = (await res.json()) as { access?: string }
    return data.access ?? null
  } catch {
    return null
  }
}

export function cookieOptions(name: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: name === ACCESS_COOKIE ? ACCESS_SECONDS : REFRESH_SECONDS,
  }
}

export async function createSession(tokens: Tokens) {
  const jar = await cookies()
  jar.set(ACCESS_COOKIE, tokens.access, cookieOptions(ACCESS_COOKIE))
  if (tokens.refresh) jar.set(REFRESH_COOKIE, tokens.refresh, cookieOptions(REFRESH_COOKIE))
}

/** Logs out: blacklists the refresh token in Django and clears both cookies. */
export async function deleteSession() {
  const jar = await cookies()
  const refresh = jar.get(REFRESH_COOKIE)?.value
  if (refresh) {
    await fetch(`${API_URL}/auth/logout/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
      cache: "no-store",
    }).catch(() => undefined)
  }
  jar.delete(ACCESS_COOKIE)
  jar.delete(REFRESH_COOKIE)
}
