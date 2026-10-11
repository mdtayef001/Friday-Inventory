"use client"

import Link from "next/link"
import { FileText, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Pill, type PillTone } from "@/components/common"
import { formatTaka } from "@/lib/business"
import { formatDate, formatDateTime } from "@/lib/format"
import type { BusinessStatus, Payment, PaymentStatus } from "@/lib/types"

export const STATUS: Record<BusinessStatus, { label: string; tone: PillTone }> = {
  active: { label: "Active", tone: "green" },
  trial: { label: "Free trial", tone: "blue" },
  unpaid: { label: "Unpaid · locked", tone: "amber" },
  suspended: { label: "Suspended", tone: "red" },
}

export function BusinessStatusPill({ status }: { status: BusinessStatus }) {
  return <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill>
}

const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: PillTone }> = {
  paid: { label: "Paid", tone: "green" },
  pending: { label: "Not finished", tone: "gray" },
  failed: { label: "Failed", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
}

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  return <Pill tone={PAYMENT_STATUS[status].tone}>{PAYMENT_STATUS[status].label}</Pill>
}

/** Payment history. `showBusiness` adds a business column for the super admin. */
export function PaymentsTable({ payments, showBusiness = false }: { payments: Payment[]; showBusiness?: boolean }) {
  if (payments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 pt-2 pb-8 text-center text-sm text-muted-foreground">
        <Receipt className="size-8" />
        No payments yet.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Date</TableHead>
            {showBusiness && <TableHead>Business</TableHead>}
            <TableHead>Invoice</TableHead>
            <TableHead>Covers</TableHead>
            <TableHead>Method</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="pl-4 text-sm whitespace-nowrap">{formatDateTime(p.paidAt ?? p.createdAt)}</TableCell>
              {showBusiness && (
                <TableCell>
                  <Link href={`/platform/businesses/${p.businessId}`} className="font-medium hover:underline">
                    {p.businessName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {p.payer.name} · {p.payer.phone}
                  </div>
                </TableCell>
              )}
              <TableCell className="font-mono text-xs">{p.invoiceNo ?? "—"}</TableCell>
              <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                {p.periodStart && p.periodEnd ? `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` : "—"}
              </TableCell>
              <TableCell className="text-sm">{p.method ?? "—"}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatTaka(p.amount)}</TableCell>
              <TableCell>
                <PaymentStatusPill status={p.status} />
              </TableCell>
              <TableCell className="pr-4">
                {p.status === "paid" && (
                  <Button variant="ghost" size="sm" render={<Link href={`/invoice/${p.id}`} target="_blank" />} nativeButton={false}>
                    <FileText />
                    Invoice
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
