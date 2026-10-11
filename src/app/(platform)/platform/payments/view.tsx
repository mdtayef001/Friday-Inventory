"use client"

import { useMemo, useState } from "react"
import { CircleDollarSign, Receipt, Search, XCircle } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageBody, PageHeader, SimpleSelect, StatCard } from "@/components/common"
import { PaymentsTable } from "@/components/platform"
import { formatTaka } from "@/lib/business"
import type { Payment, PaymentStatus } from "@/lib/types"

const FILTERS: { value: "all" | PaymentStatus; label: string }[] = [
  { value: "all", label: "All payments" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "pending", label: "Not finished" },
]

export function PaymentsView({ payments }: { payments: Payment[] }) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | PaymentStatus>("all")

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return payments.filter(
      (p) =>
        (status === "all" || p.status === status) &&
        (!q || [p.businessName, p.payer.name, p.payer.phone, p.invoiceNo, p.tranId].some((v) => v?.toLowerCase().includes(q))),
    )
  }, [payments, query, status])

  const paid = payments.filter((p) => p.status === "paid")
  const failed = payments.filter((p) => p.status === "failed" || p.status === "cancelled").length

  return (
    <PageBody>
      <PageHeader title="Payments" description="Who has paid, through SSLCommerz, and every attempt that didn't go through." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Collected (all time)" value={formatTaka(paid.reduce((s, p) => s + p.amount, 0))} icon={CircleDollarSign} tone="green" />
        <StatCard label="Paid invoices" value={paid.length} icon={Receipt} />
        <StatCard label="Failed or cancelled" value={failed} icon={XCircle} tone={failed ? "red" : "default"} />
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search business, payer, phone, invoice or transaction…" className="h-9 pl-9" />
        </div>
        <SimpleSelect value={status} onChange={(v) => setStatus(v as "all" | PaymentStatus)} options={FILTERS} className="h-9! md:w-44" />
      </div>

      <Card className="py-0">
        <PaymentsTable payments={rows} showBusiness />
      </Card>
    </PageBody>
  )
}
