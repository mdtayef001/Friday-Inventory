import { Suspense } from "react"
import type { Metadata } from "next"
import { PageSkeleton } from "@/components/store-gate"
import { getPaymentAccounts } from "@/lib/auth/platform-actions"
import { PaymentOptionsView } from "./view"

export const metadata: Metadata = { title: "Payment options" }

export default function PaymentOptionsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PaymentOptions />
    </Suspense>
  )
}

async function PaymentOptions() {
  const { onlineStatus, ...accounts } = await getPaymentAccounts()
  return <PaymentOptionsView accounts={accounts} onlineStatus={onlineStatus} />
}
