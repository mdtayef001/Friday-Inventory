"use server"

import { z } from "zod"
import { api, toResult, type ActionResult } from "@/lib/api/server"
import { CURRENCIES } from "@/lib/business"
import { requireAccess } from "./dal"

const flag = z.boolean()
const SettingsSchema = z.object({
  name: z.string().trim().min(2, "Business name must be at least 2 characters").max(80),
  industry: z.string().trim().max(60),
  settings: z.object({
    currency: z.enum(CURRENCIES as [string, ...string[]]),
    modules: z.object({ rentals: flag, tracking: flag, transfers: flag, trackingLinks: flag }),
    permissions: z.object({
      managerUsers: flag,
      managerActivity: flag,
      managerProfit: flag,
      managerProducts: flag,
      managerLocations: flag,
      staffCreateProducts: flag,
    }),
    payments: z.object({ mobile: flag, mobileNumber: z.string().trim().max(60), card: flag, online: flag }),
  }),
})

/** Owner only: business profile, feature switches and team permissions. */
export async function updateBusinessSettings(input: z.input<typeof SettingsSchema>): Promise<ActionResult> {
  await requireAccess("/settings")
  const parsed = SettingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  return toResult(() => api("business/", { method: "PATCH", body: parsed.data }))
}

export interface MerchantAccount {
  configured: boolean
  storeId?: string
  sandbox?: boolean
  hasPassword?: boolean
}

/** Owner only: the business's own SSLCommerz account (the password is never returned). */
export async function getMerchantAccount(): Promise<MerchantAccount> {
  await requireAccess("/settings")
  return api<MerchantAccount>("business/merchant/")
}

const MerchantSchema = z.object({
  storeId: z.string().trim().min(1, "Enter the Store ID").max(100),
  storePassword: z.string().max(200),
  sandbox: z.boolean(),
})

export async function saveMerchantAccount(input: z.input<typeof MerchantSchema>): Promise<ActionResult> {
  await requireAccess("/settings")
  const parsed = MerchantSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  return toResult(() => api("business/merchant/", { method: "PUT", body: parsed.data }))
}

export async function removeMerchantAccount(): Promise<ActionResult> {
  await requireAccess("/settings")
  return toResult(() => api("business/merchant/", { method: "DELETE" }))
}
