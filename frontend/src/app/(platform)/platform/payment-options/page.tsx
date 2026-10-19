import type { Metadata } from "next"
import { getPaymentAccounts } from "@/lib/auth/platform-actions"
import { PaymentOptionsView } from "./view"

export const metadata: Metadata = { title: "Payment options" }

export default async function PaymentOptionsPage() {
  const { onlineStatus, ...accounts } = await getPaymentAccounts()
  return <PaymentOptionsView accounts={accounts} onlineStatus={onlineStatus} />
}
