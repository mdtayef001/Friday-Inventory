"use server"

import { z } from "zod"
import { api, apiOrNull, toResult, type ActionResult } from "@/lib/api/server"
import { ApiError } from "@/lib/api/errors"
import type { BusinessSummary, ManagedUser, Payment } from "@/lib/types"
import { requireRole } from "./dal"

// Super admin only. Every action re-checks the role here, and Django again.
const requireSuper = () => requireRole(["superadmin"])
const businessPath = (id: string) => `platform/businesses/${encodeURIComponent(id)}/`

export async function getBusinesses(): Promise<BusinessSummary[]> {
  await requireSuper()
  return api("platform/businesses/")
}

export async function getBusiness(id: string): Promise<{ business: BusinessSummary; users: ManagedUser[]; payments: Payment[] } | null> {
  await requireSuper()
  if (!/^\d+$/.test(id)) return null
  return apiOrNull(businessPath(id))
}

/** Every payment attempt on the platform, newest first. */
export async function getPayments(): Promise<Payment[]> {
  await requireSuper()
  return api("platform/payments/")
}

const CreateSchema = z.object({
  name: z.string().trim().min(2, "Business name must be at least 2 characters").max(80),
  industry: z.string().trim().max(60),
  ownerName: z.string().trim().min(2, "Owner name must be at least 2 characters").max(80),
  ownerEmail: z.email("Enter a valid owner email").trim(),
  ownerPassword: z.string().min(8, "Password must be at least 8 characters").max(128),
})

export async function createBusiness(input: z.input<typeof CreateSchema>): Promise<ActionResult & { id?: string }> {
  await requireSuper()
  const parsed = CreateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  try {
    const business = await api<BusinessSummary>("platform/businesses/", { method: "POST", body: parsed.data })
    return { ok: true, id: business.id }
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message }
    throw err
  }
}

/** Switch a business off by hand, or back on. Paying doesn't lift a manual suspension. */
export async function setBusinessSuspended(id: string, suspended: boolean): Promise<ActionResult> {
  await requireSuper()
  if (typeof suspended !== "boolean") return { ok: false, error: "Invalid request." }
  return toResult(() => api(`${businessPath(id)}suspend/`, { method: "POST", body: { suspended } }))
}

export async function resetOwnerPassword(userId: string, password: string): Promise<ActionResult> {
  await requireSuper()
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return { ok: false, error: "Password must be at least 8 characters" }
  }
  return toResult(() => api(`platform/users/${encodeURIComponent(userId)}/password/`, { method: "POST", body: { password } }))
}

export async function deleteBusiness(id: string): Promise<ActionResult> {
  await requireSuper()
  return toResult(() => api(businessPath(id), { method: "DELETE" }))
}
