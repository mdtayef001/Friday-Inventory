import "server-only"
import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import type { Business, Role, SessionUser } from "@/lib/types"
import { ROLE_HOME, canAccess } from "./roles"
import { SESSION_COOKIE, decrypt } from "./session"
import { findBusiness } from "./tenants"
import { findUserById } from "./users"

export interface Context {
  user: SessionUser
  /** The user's business. Null only for the platform super admin. */
  business: Business | null
}

/**
 * Data access layer: the one place that turns the session cookie into a user.
 * Re-checks the user and their business on every request, so disabling an
 * account, changing its role or suspending the business takes effect
 * immediately, even with a valid cookie.
 */
export const getContext = cache(async (): Promise<Context | null> => {
  const session = await decrypt((await cookies()).get(SESSION_COOKIE)?.value)
  if (!session) return null
  const record = findUserById(session.userId)
  if (!record || !record.active || record.role !== session.role) return null
  const { id, name, email, role, tenantId, locationIds } = record
  const user: SessionUser = { id, name, email, role, tenantId, locationIds }

  if (role === "superadmin") return { user, business: null }
  const business = tenantId ? findBusiness(tenantId) : null
  if (!business || business.status === "suspended") return null
  return { user, business }
})

export async function getCurrentUser() {
  return (await getContext())?.user ?? null
}

/** Use at the top of pages and server actions. Redirects if not allowed. */
export async function requireRole(roles: Role[]): Promise<Context> {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  if (!roles.includes(ctx.user.role)) redirect(ROLE_HOME[ctx.user.role])
  return ctx
}

/** Business pages: checks the role, the owner's feature switches and permissions. */
export async function requireAccess(path: string): Promise<{ user: SessionUser; business: Business }> {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  const { user, business } = ctx
  if (!business || !canAccess(user, path, business.settings)) redirect(ROLE_HOME[user.role])
  return { user, business }
}
