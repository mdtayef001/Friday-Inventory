import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { isTestGateway, listPayments } from "@/lib/billing/queries"
import { BillingView } from "./view"

export const metadata: Metadata = { title: "Billing" }

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  await requireAccess("/billing")
  const { payment, tran } = await searchParams
  const [payments, testGateway] = await Promise.all([listPayments(), isTestGateway()])
  const justPaid = payment === "success" ? payments.find((p) => p.tranId === tran && p.status === "paid") : undefined
  return (
    <BillingView
      payments={payments}
      notice={justPaid ? { kind: "success", paymentId: justPaid.id, invoiceNo: justPaid.invoiceNo! } : payment === "failed" || payment === "cancelled" ? { kind: payment } : null}
      testGateway={testGateway}
    />
  )
}
