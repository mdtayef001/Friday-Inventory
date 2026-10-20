import { Suspense } from "react"
import type { Metadata } from "next"
import { PageSkeleton } from "@/components/store-gate"
import { getPayments } from "@/lib/auth/platform-actions"
import { PaymentsView } from "./view"

export const metadata: Metadata = { title: "Payments" }

export default function PaymentsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Payments />
    </Suspense>
  )
}

async function Payments() {
  return <PaymentsView payments={await getPayments()} />
}
