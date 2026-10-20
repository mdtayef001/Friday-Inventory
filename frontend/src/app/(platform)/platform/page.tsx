import { Suspense } from "react"
import type { Metadata } from "next"
import { PageSkeleton } from "@/components/store-gate"
import { getBusinesses, getPayments } from "@/lib/auth/platform-actions"
import { PlatformOverview } from "./view"

export const metadata: Metadata = { title: "Platform" }

// The data loads behind a placeholder, so moving between platform pages shows something right away.
export default function PlatformPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  )
}

async function Overview() {
  const [businesses, payments] = await Promise.all([getBusinesses(), getPayments()])
  return <PlatformOverview businesses={businesses} payments={payments} />
}
