import { Suspense } from "react"
import type { Metadata } from "next"
import { PageSkeleton } from "@/components/store-gate"
import { getBusinesses, getPaymentAccounts, getPayments } from "@/lib/auth/platform-actions"
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
  const [businesses, payments, { monthlyPrice }] = await Promise.all([getBusinesses(), getPayments(), getPaymentAccounts()])
  return <PlatformOverview businesses={businesses} payments={payments} monthlyPrice={monthlyPrice} />
}
