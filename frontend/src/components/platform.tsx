"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Check, FileText, Receipt, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmAction, Field, Pill, type PillTone } from "@/components/common"
import { reviewPayment } from "@/lib/auth/platform-actions"
import { formatTaka } from "@/lib/business"
import { formatDate, formatDateTime, shortMethod } from "@/lib/format"
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
  awaiting: { label: "Waiting for approval", tone: "amber" },
  failed: { label: "Failed", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
  rejected: { label: "Rejected", tone: "red" },
}

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  return <Pill tone={PAYMENT_STATUS[status].tone}>{PAYMENT_STATUS[status].label}</Pill>
}

/** Payment history. `showBusiness` adds a business column, and `review` Approve / Reject buttons, for the super admin. */
export function PaymentsTable({ payments, showBusiness = false, review = false }: { payments: Payment[]; showBusiness?: boolean; review?: boolean }) {
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
                    {p.payer.name}
                    {p.payer.phone && ` · ${p.payer.phone}`}
                  </div>
                </TableCell>
              )}
              <TableCell className="font-mono text-xs whitespace-nowrap">{p.invoiceNo || "—"}</TableCell>
              <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                {p.periodStart && p.periodEnd ? `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` : "—"}
              </TableCell>
              <TableCell className="text-sm whitespace-nowrap" title={p.method || undefined}>
                {p.channel === "manual" ? p.method : shortMethod(p.method)}
                {p.reference && <div className="font-mono text-xs text-muted-foreground">{p.reference}</div>}
                {p.sentFrom && <div className="text-xs text-muted-foreground">from {p.sentFrom}</div>}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatTaka(p.amount)}</TableCell>
              <TableCell>
                <PaymentStatusPill status={p.status} />
                {p.months > 1 && <div className="text-xs text-muted-foreground">{p.months} months</div>}
                {p.note && <div className="max-w-48 text-xs text-muted-foreground">{p.note}</div>}
              </TableCell>
              <TableCell className="pr-4 whitespace-nowrap">
                {review && p.status === "awaiting" && <ReviewButtons payment={p} />}
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

/** Approve once the money shows up in your bKash/bank, or reject it with a reason the owner sees. */
function ReviewButtons({ payment: p }: { payment: Payment }) {
  const [rejecting, setRejecting] = useState(false)
  const months = `${p.months} ${p.months === 1 ? "month" : "months"}`
  return (
    <div className="flex gap-1">
      <ConfirmAction
        trigger={
          <Button size="sm">
            <Check />
            Approve
          </Button>
        }
        title={`Approve ${formatTaka(p.amount)} from ${p.businessName}?`}
        description={`Only if ${formatTaka(p.amount)} by ${p.method} with ${p.reference} has arrived. ${p.businessName} gets ${months} and an invoice.`}
        confirmLabel="Approve"
        onConfirm={async () => {
          const result = await reviewPayment(p.id, "approve")
          if (result.ok) toast.success(`Approved. ${p.businessName} has ${months} more.`)
          else toast.error(result.error)
          return result.ok
        }}
      />
      <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
        <X />
        Reject
      </Button>
      {rejecting && <RejectDialog payment={p} onClose={() => setRejecting(false)} />}
    </div>
  )
}

function RejectDialog({ payment: p, onClose }: { payment: Payment; onClose: () => void }) {
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            startTransition(async () => {
              const result = await reviewPayment(p.id, "reject", note)
              if (!result.ok) return void toast.error(result.error)
              toast.success("Rejected")
              onClose()
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Reject this payment?</DialogTitle>
            <DialogDescription>
              {formatTaka(p.amount)} by {p.method}, TrxID {p.reference}. {p.businessName} stays as it is, and the owner sees your reason.
            </DialogDescription>
          </DialogHeader>
          <Field label="Reason (optional)" htmlFor="reject-note">
            <Input id="reject-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Not received, or the amount was ৳500" maxLength={300} autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              Reject
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
