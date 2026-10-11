"use server"

import { refresh } from "next/cache"
import { z } from "zod"
import { CURRENCIES } from "@/lib/plans"
import { requireAccess } from "./dal"
import { patchBusiness } from "./tenants"
import type { ActionResult } from "./user-actions"

const flag = z.boolean()
const SettingsSchema = z.object({
  name: z.string().trim().min(2, "Business name must be at least 2 characters").max(80),
  industry: z.string().trim().max(60),
  settings: z.object({
    currency: z.enum(CURRENCIES as [string, ...string[]]),
    modules: z.object({ rentals: flag, tracking: flag, transfers: flag }),
    permissions: z.object({
      managerUsers: flag,
      managerActivity: flag,
      managerProducts: flag,
      managerLocations: flag,
      staffCreateProducts: flag,
    }),
  }),
})

/** Owner only: business profile, feature switches and team permissions. */
export async function updateBusinessSettings(input: z.input<typeof SettingsSchema>): Promise<ActionResult> {
  const { business } = await requireAccess("/settings")
  const parsed = SettingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  patchBusiness(business.id, parsed.data)
  refresh()
  return { ok: true }
}
