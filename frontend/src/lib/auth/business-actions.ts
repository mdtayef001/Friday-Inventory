"use server"

import { z } from "zod"
import { api, toResult, type ActionResult } from "@/lib/api/server"
import { requireAccess, requireOwner } from "./dal"

const flag = z.boolean()
const SettingsSchema = z.object({
  name: z.string().trim().min(2, "Business name must be at least 2 characters").max(80),
  industry: z.string().trim().max(60),
  settings: z.object({
    // BDT or USD, or the one the business already had before the list was narrowed; Django checks.
    currency: z.string().length(3),
    modules: z.object({ rentals: flag, tracking: flag, transfers: flag, trackingLinks: flag, purchases: flag }),
    permissions: z.object({
      managerUsers: flag,
      managerActivity: flag,
      managerProfit: flag,
      managerProducts: flag,
      managerLocations: flag,
      staffCreateProducts: flag,
      managerPurchases: flag,
      managerReturns: flag,
      staffWalkInSales: flag,
    }),
    payments: z.object({ mobile: flag, card: flag }),
    receiptNote: z.string().trim().max(200, "Keep the receipt note under 200 characters."),
    lowStockAlert: z.number().int("The low-stock alert must be a whole number.").min(0).max(100_000),
  }),
})

/** Owner only: business profile, feature switches and team permissions. */
export async function updateBusinessSettings(input: z.input<typeof SettingsSchema>): Promise<ActionResult> {
  await requireAccess("/settings")
  const parsed = SettingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  return toResult(() => api("business/", { method: "PATCH", body: parsed.data }))
}

/** Owner: stop renewing (access runs to the end of what's paid), or take it back. Works while locked. */
export async function setSubscriptionCancelled(cancelled: boolean): Promise<ActionResult> {
  await requireOwner()
  if (typeof cancelled !== "boolean") return { ok: false, error: "Invalid request." }
  return toResult(() => api("business/subscription/", { method: "POST", body: { cancelled } }))
}

/** The Owner asks for the business to be deleted, typing its name to be sure. The super admin approves it. */
export async function requestDeletion(name: string): Promise<ActionResult> {
  await requireOwner()
  if (typeof name !== "string" || !name.trim()) return { ok: false, error: "Type the business name." }
  return toResult(() => api("business/deletion/", { method: "POST", body: { name } }))
}

/** Owner: keep the business after all, before or after the super admin approved the deletion. */
export async function cancelDeletion(): Promise<ActionResult> {
  await requireOwner()
  return toResult(() => api("business/deletion/", { method: "DELETE" }))
}
