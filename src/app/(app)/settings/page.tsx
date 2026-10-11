import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { SettingsView } from "./view"

export const metadata: Metadata = { title: "Business Settings" }

export default async function SettingsPage() {
  await requireAccess("/settings")
  return <SettingsView />
}
