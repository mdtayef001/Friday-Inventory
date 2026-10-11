import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { DashboardView } from "./view"

export const metadata: Metadata = { title: "Dashboard" }

export default async function DashboardPage() {
  await requireRole(["admin", "manager"])
  return <DashboardView />
}
