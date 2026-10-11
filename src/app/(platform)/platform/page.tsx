import type { Metadata } from "next"
import { getBusinesses, getPayments } from "@/lib/auth/platform-actions"
import { PlatformOverview } from "./view"

export const metadata: Metadata = { title: "Platform" }

export default async function PlatformPage() {
  const [businesses, payments] = await Promise.all([getBusinesses(), getPayments()])
  return <PlatformOverview businesses={businesses} payments={payments} />
}
