import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { TrackingView } from "./view"

export const metadata: Metadata = { title: "Order Tracking" }

export default async function TrackingPage() {
  await requireAccess("/tracking")
  return <TrackingView />
}
