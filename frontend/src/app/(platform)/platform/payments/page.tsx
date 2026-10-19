import type { Metadata } from "next"
import { getPayments } from "@/lib/auth/platform-actions"
import { PaymentsView } from "./view"

export const metadata: Metadata = { title: "Payments" }

export default async function PaymentsPage() {
  return <PaymentsView payments={await getPayments()} />
}
