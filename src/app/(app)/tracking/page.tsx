import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { TrackingView } from "./view"

export const metadata: Metadata = { title: "Order Tracking" }

export default async function TrackingPage() {
  await requireRole(["admin", "manager"])
  return <TrackingView />
}
