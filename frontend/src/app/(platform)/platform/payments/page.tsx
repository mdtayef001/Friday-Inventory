import type { Metadata } from "next"
import { getPaymentAccounts, getPayments } from "@/lib/auth/platform-actions"
import { PaymentsView } from "./view"

export const metadata: Metadata = { title: "Payments" }

export default async function PaymentsPage() {
  const [payments, accounts] = await Promise.all([getPayments(), getPaymentAccounts()])
  return <PaymentsView payments={payments} accounts={accounts} />
}
