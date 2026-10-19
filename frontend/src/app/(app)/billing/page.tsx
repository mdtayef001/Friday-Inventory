import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { getBillingConfig, listPayments } from "@/lib/billing/queries"
import { BillingView } from "./view"

export const metadata: Metadata = { title: "Billing" }

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  await requireAccess("/billing")
  const { payment, tran } = await searchParams
  const [payments, config] = await Promise.all([listPayments(), getBillingConfig()])
  const justPaid = payment === "success" ? payments.find((p) => p.tranId === tran && p.status === "paid") : undefined
  return (
    <BillingView
      payments={payments}
      notice={justPaid ? { kind: "success", paymentId: justPaid.id, invoiceNo: justPaid.invoiceNo! } : payment === "failed" || payment === "cancelled" ? { kind: payment } : null}
      config={config}
    />
  )
}
