"use server"

import { refresh } from "next/cache"
import { z } from "zod"
import { listPayments, removeBusinessPayments } from "@/lib/billing/payments"
import type { BusinessSummary, ManagedUser, Payment } from "@/lib/types"
import { requireRole } from "./dal"
import { findBusiness, insertBusiness, listBusinesses, patchBusiness, removeBusiness } from "./tenants"
import type { ActionResult } from "./user-actions"
import { emailTaken, findUserById, insertUser, listUsers, patchUser, removeTenantUsers } from "./users"

// Super admin only. Every action re-checks the role on the server.
const requireSuper = () => requireRole(["superadmin"])

function summarize(business: ReturnType<typeof listBusinesses>[number], users: ManagedUser[]): BusinessSummary {
  const team = users.filter((u) => u.tenantId === business.id)
  const owner = team.find((u) => u.role === "owner")
  const lastActiveAt = team.map((u) => u.lastLoginAt).filter(Boolean).sort().at(-1)
  return {
    ...business,
    owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
    userCount: team.length,
    lastActiveAt,
  }
}

export async function getBusinesses(): Promise<BusinessSummary[]> {
  await requireSuper()
  const users = listUsers()
  return listBusinesses().map((b) => summarize(b, users))
}

export async function getBusiness(id: string): Promise<{ business: BusinessSummary; users: ManagedUser[]; payments: Payment[] } | null> {
  await requireSuper()
  const business = findBusiness(id)
  if (!business) return null
  const users = listUsers(id)
  return { business: summarize(business, users), users, payments: listPayments(id) }
}

/** Every payment attempt on the platform, newest first. */
export async function getPayments(): Promise<Payment[]> {
  await requireSuper()
  return listPayments()
}

const CreateSchema = z.object({
  name: z.string().trim().min(2, "Business name must be at least 2 characters").max(80),
  industry: z.string().trim().max(60),
  ownerName: z.string().trim().min(2, "Owner name must be at least 2 characters").max(80),
  ownerEmail: z.email("Enter a valid owner email").trim(),
  ownerPassword: z.string().min(8, "Password must be at least 8 characters").max(128),
})

export async function createBusiness(input: z.input<typeof CreateSchema>): Promise<ActionResult & { id?: string }> {
  const { user } = await requireSuper()
  const parsed = CreateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  const d = parsed.data
  if (emailTaken(d.ownerEmail)) return { ok: false, error: "An account with this email already exists." }

  const business = insertBusiness({ name: d.name, industry: d.industry })
  insertUser({ name: d.ownerName, email: d.ownerEmail, password: d.ownerPassword, role: "owner", tenantId: business.id, locationIds: [], createdBy: user.id })
  refresh()
  return { ok: true, id: business.id }
}

/** Switch a business off by hand, or back on. Paying doesn't lift a manual suspension. */
export async function setBusinessSuspended(id: string, suspended: boolean): Promise<ActionResult> {
  await requireSuper()
  if (typeof suspended !== "boolean" || !patchBusiness(id, { suspended })) return { ok: false, error: "Business not found." }
  refresh()
  return { ok: true }
}

export async function resetOwnerPassword(userId: string, password: string): Promise<ActionResult> {
  await requireSuper()
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return { ok: false, error: "Password must be at least 8 characters" }
  }
  const target = findUserById(userId)
  if (!target || target.role === "superadmin") return { ok: false, error: "Account not found." }
  patchUser(userId, { password })
  refresh()
  return { ok: true }
}

export async function deleteBusiness(id: string): Promise<ActionResult> {
  await requireSuper()
  if (!removeBusiness(id)) return { ok: false, error: "Business not found." }
  removeTenantUsers(id)
  removeBusinessPayments(id)
  refresh()
  return { ok: true }
}
