"use client"

import { useMemo, useState, useTransition } from "react"
import { CircleDollarSign, Hourglass, Landmark, Receipt, Search, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, PageBody, PageHeader, SimpleSelect, StatCard } from "@/components/common"
import { PaymentsTable } from "@/components/platform"
import { savePaymentAccounts } from "@/lib/auth/platform-actions"
import { formatTaka } from "@/lib/business"
import type { Payment, PaymentAccounts, PaymentStatus } from "@/lib/types"

const FILTERS: { value: "all" | PaymentStatus; label: string }[] = [
  { value: "all", label: "All payments" },
  { value: "awaiting", label: "Waiting for approval" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "pending", label: "Not finished" },
]

export function PaymentsView({ payments, accounts }: { payments: Payment[]; accounts: PaymentAccounts }) {
  const waiting = payments.filter((p) => p.status === "awaiting").length
  const [query, setQuery] = useState("")
  // Payments to check come first.
  const [status, setStatus] = useState<"all" | PaymentStatus>(waiting ? "awaiting" : "all")

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return payments.filter(
      (p) =>
        (status === "all" || p.status === status) &&
        (!q || [p.businessName, p.payer.name, p.payer.phone, p.invoiceNo, p.tranId, p.reference, p.sentFrom].some((v) => v?.toLowerCase().includes(q))),
    )
  }, [payments, query, status])

  const paid = payments.filter((p) => p.status === "paid")
  const failed = payments.filter((p) => p.status === "failed" || p.status === "cancelled").length

  return (
    <PageBody>
      <PageHeader title="Payments" description="Who has paid, money sent by hand waiting for you to check, and every attempt that didn't go through." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Waiting for approval"
          value={waiting}
          hint={waiting ? "Check your bKash or bank, then approve" : "Nothing to check"}
          icon={Hourglass}
          tone={waiting ? "amber" : "default"}
        />
        <StatCard label="Collected (all time)" value={formatTaka(paid.reduce((s, p) => s + p.amount, 0))} icon={CircleDollarSign} tone="green" />
        <StatCard label="Paid invoices" value={paid.length} icon={Receipt} />
        <StatCard label="Failed or cancelled" value={failed} icon={XCircle} tone={failed ? "red" : "default"} />
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search business, payer, phone, invoice, TrxID…" className="h-9 pl-9" />
        </div>
        <SimpleSelect value={status} onChange={(v) => setStatus(v as "all" | PaymentStatus)} options={FILTERS} className="h-9! md:w-44" />
      </div>

      <Card className="py-0">
        <PaymentsTable payments={rows} showBusiness review />
      </Card>

      <AccountsCard accounts={accounts} />
    </PageBody>
  )
}

/** The numbers and bank details owners see on their Billing page when paying by hand. */
function AccountsCard({ accounts }: { accounts: PaymentAccounts }) {
  const [form, setForm] = useState(accounts)
  const [pending, startTransition] = useTransition()
  const set = (key: keyof PaymentAccounts) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const changed = (Object.keys(form) as (keyof PaymentAccounts)[]).some((k) => form[k] !== accounts[k])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="size-4 text-primary" />
          Where owners send money
        </CardTitle>
        <CardDescription>Shown on every owner&apos;s Billing page. Leave one empty to hide it.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            startTransition(async () => {
              const result = await savePaymentAccounts(form)
              if (result.ok) toast.success("Saved")
              else toast.error(result.error)
            })
          }}
        >
          <div className="grid gap-3">
            <Field label="bKash number" htmlFor="acc-bkash">
              <Input id="acc-bkash" value={form.bkash} onChange={set("bkash")} inputMode="tel" maxLength={40} className="font-mono" />
            </Field>
            <Field label="Nagad number" htmlFor="acc-nagad">
              <Input id="acc-nagad" value={form.nagad} onChange={set("nagad")} inputMode="tel" maxLength={40} className="font-mono" />
            </Field>
            <Field label="Rocket number" htmlFor="acc-rocket">
              <Input id="acc-rocket" value={form.rocket} onChange={set("rocket")} inputMode="tel" maxLength={40} className="font-mono" />
            </Field>
          </div>
          <div className="grid content-start gap-3">
            <Field label="Bank account" htmlFor="acc-bank" hint="Account name, number, bank and branch, one per line.">
              <Textarea id="acc-bank" value={form.bank} onChange={set("bank")} rows={4} maxLength={500} />
            </Field>
            <Field label="Phone or WhatsApp for payment questions" htmlFor="acc-contact">
              <Input id="acc-contact" value={form.contact} onChange={set("contact")} maxLength={100} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={pending || !changed}>
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
