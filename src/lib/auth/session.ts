import "server-only"
import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import type { Role } from "@/lib/types"

export const SESSION_COOKIE = "friday_session"
const SESSION_HOURS = 12
const ROLES: Role[] = ["superadmin", "owner", "manager", "staff"]

export interface SessionPayload {
  userId: string
  role: Role
  expiresAt: number
}

function key() {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters (see .env.example)")
  }
  return new TextEncoder().encode(secret)
}

export async function encrypt(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key())
}

export async function decrypt(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] })
    if (typeof payload.userId !== "string" || !ROLES.includes(payload.role as Role)) return null
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

export async function createSession(userId: string, role: Role) {
  const expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000
  const token = await encrypt({ userId, role, expiresAt })
  ;(await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  })
}

export async function deleteSession() {
  ;(await cookies()).delete(SESSION_COOKIE)
}
