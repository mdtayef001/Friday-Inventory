"use server"

import { z } from "zod"
import { api, toResult, type ActionResult } from "@/lib/api/server"
import { requireAccess } from "./dal"

const flag = z.boolean()
const SettingsSchema = z.object({
  name: z.string().trim().min(2, "Business name must be at least 2 characters").max(80),
  industry: z.string().trim().max(60),
  settings: z.object({
    // BDT or USD, or the one the business already had before the list was narrowed; Django checks.
    currency: z.string().length(3),
    modules: z.object({ rentals: flag, tracking: flag, transfers: flag, trackingLinks: flag }),
    permissions: z.object({
      managerUsers: flag,
      managerActivity: flag,
      managerProfit: flag,
      managerProducts: flag,
      managerLocations: flag,
      staffCreateProducts: flag,
    }),
    payments: z.object({ mobile: flag, card: flag }),
  }),
})

/** Owner only: business profile, feature switches and team permissions. */
export async function updateBusinessSettings(input: z.input<typeof SettingsSchema>): Promise<ActionResult> {
  await requireAccess("/settings")
  const parsed = SettingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  return toResult(() => api("business/", { method: "PATCH", body: parsed.data }))
}
