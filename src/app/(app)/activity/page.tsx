import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { ActivityView } from "./view"

export const metadata: Metadata = { title: "Activity Log" }

export default async function ActivityPage() {
  await requireRole(["admin"])
  return <ActivityView />
}
