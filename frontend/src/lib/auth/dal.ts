import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { api } from "@/lib/api/server"
import { ApiError } from "@/lib/api/errors"
import type { Business, Role, SessionUser } from "@/lib/types"
import { ROLE_HOME, canAccess } from "./roles"

export interface Context {
  user: SessionUser
  /** The user's business. Null only for the platform super admin. */
  business: Business | null
  /** Trial or paid month ran out. Only the owner gets in, and only to pay. */
  locked: boolean
}

/**
 * Data access layer: the one place that turns the login into a user. Asks
 * Django on every request, so disabling an account, changing its role or
 * suspending the business takes effect immediately, even with a valid token.
 */
export const getContext = cache(async (): Promise<Context | null> => {
  let me: { user: SessionUser; business: Business | null }
  try {
    me = await api("auth/me/")
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
  const { user, business } = me
  if (user.role === "superadmin") return { user, business: null, locked: false }
  if (!business || business.status === "suspended") return null
  // Unpaid, or being deleted: only the owner gets in, to pay, download their data or stop the deletion.
  const locked = business.status === "unpaid" || business.status === "closing"
  if (locked && user.role !== "owner") return null
  return { user, business, locked }
})

export async function getCurrentUser() {
  return (await getContext())?.user ?? null
}

/** Use at the top of pages and server actions. Redirects if not allowed. */
export async function requireRole(roles: Role[]): Promise<Context> {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  if (ctx.locked) redirect("/subscribe")
  if (!roles.includes(ctx.user.role)) redirect(ROLE_HOME[ctx.user.role])
  return ctx
}

/** Business pages: checks the role, the owner's feature switches and permissions. */
export async function requireAccess(path: string): Promise<{ user: SessionUser; business: Business }> {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  if (ctx.locked) redirect("/subscribe")
  const { user, business } = ctx
  if (!business || !canAccess(user, path, business.settings)) redirect(ROLE_HOME[user.role])
  return { user, business }
}

/** Billing pages: the owner, even while the business is locked for not paying. */
export async function requireOwner(): Promise<{ user: SessionUser; business: Business; locked: boolean }> {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  if (ctx.user.role !== "owner" || !ctx.business) redirect(ROLE_HOME[ctx.user.role])
  return { user: ctx.user, business: ctx.business, locked: ctx.locked }
}
