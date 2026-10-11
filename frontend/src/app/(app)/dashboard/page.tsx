import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { DashboardView } from "./view"

export const metadata: Metadata = { title: "Dashboard" }

export default async function DashboardPage() {
  await requireAccess("/dashboard")
  return <DashboardView />
}
