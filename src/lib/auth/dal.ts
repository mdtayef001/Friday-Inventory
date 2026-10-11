import "server-only"
import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import type { Role, SessionUser } from "@/lib/types"
import { ROLE_HOME } from "./roles"
import { SESSION_COOKIE, decrypt } from "./session"
import { findUserById } from "./users"

/**
 * Data access layer: the one place that turns the session cookie into a user.
 * Re-checks the user record on every request, so disabling an account or
 * changing its role takes effect immediately, even with a valid cookie.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await decrypt((await cookies()).get(SESSION_COOKIE)?.value)
  if (!session) return null
  const user = findUserById(session.userId)
  if (!user || !user.active || user.role !== session.role) return null
  const { id, name, email, role, locationIds } = user
  return { id, name, email, role, locationIds }
})

/** Use at the top of pages and server actions. Redirects if not allowed. */
export async function requireRole(roles: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) redirect("/logout")
  if (!roles.includes(user.role)) redirect(ROLE_HOME[user.role])
  return user
}
