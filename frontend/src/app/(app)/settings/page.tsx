import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { getMerchantAccount } from "@/lib/auth/business-actions"
import { SettingsView } from "./view"

export const metadata: Metadata = { title: "Business Settings" }

export default async function SettingsPage() {
  await requireAccess("/settings")
  return <SettingsView merchant={await getMerchantAccount()} />
}
