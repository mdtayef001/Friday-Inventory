import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { listUsers } from "@/lib/auth/users"
import { SettingsView } from "./view"

export const metadata: Metadata = { title: "Business Settings" }

export default async function SettingsPage() {
  const { user } = await requireAccess("/settings")
  return <SettingsView userCount={listUsers(user.tenantId).length} />
}
