import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { ActivityView } from "./view"

export const metadata: Metadata = { title: "Activity Log" }

export default async function ActivityPage() {
  await requireAccess("/activity")
  return <ActivityView />
}
