"use client"

import { useState } from "react"
import { format } from "date-fns"
import { HandCoins, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, SimpleSelect, useAttempt, useRequired } from "@/components/common"
import { PAY_METHODS } from "@/components/purchase-dialog"
import { actions } from "@/lib/data/actions"
import { formatMoney } from "@/lib/format"
import type { SupplierBrief, SupplierPaymentMethod } from "@/lib/types"

export const PAYMENT_METHOD_LABEL: Record<SupplierPaymentMethod, string> = {
  cash: "Cash",
  mobile: "Mobile banking",
  bank: "Bank",
  credit: "Return credit",
}

const today = () => format(new Date(), "yyyy-MM-dd")

/** Owners and admins: money paid to a supplier. It goes to their oldest unpaid bills first. */
export function PaySupplierDialog({ supplier, owed, onClose }: { supplier: SupplierBrief; owed: number; onClose: () => void }) {
  const [run, pending] = useAttempt()
  const required = useRequired()
  const [amount, setAmount] = useState(String(owed))
  const [method, setMethod] = useState<"cash" | "mobile" | "bank">("cash")
  const [date, setDate] = useState(today)
  const [note, setNote] = useState("")
  const money = Number(amount)
  const amountOk = amount !== "" && money > 0 && money <= owed
  const dateOk = !!date && date <= today()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!required.check(amountOk && dateOk, e)) return
    const ok = await run(
      () =>
        actions.paySupplier({
          supplierId: supplier.id,
          amount: money,
          method,
          // Today means now; an earlier day is recorded at midday so time zones can't move it a day.
          paidAt: date === today() ? undefined : new Date(`${date}T12:00:00`).toISOString(),
          note: note.trim(),
        }),
      money === owed ? `Paid. You owe ${supplier.name} nothing now.` : `Paid. You still owe ${supplier.name} ${formatMoney(owed - money)}.`,
    )
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Pay {supplier.name}</DialogTitle>
            <DialogDescription>You owe {formatMoney(owed)}. The payment goes to the oldest unpaid bills first.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" htmlFor="pay-amount" required missing={required.shown && !amountOk} hint={`Up to ${formatMoney(owed)}.`}>
              <Input id="pay-amount" type="number" inputMode="decimal" min="0.01" max={owed} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </Field>
            <Field label="Paid with" htmlFor="pay-method" required>
              <SimpleSelect id="pay-method" value={method} onChange={(v) => setMethod(v as typeof method)} options={PAY_METHODS} />
            </Field>
          </div>
          <Field label="Date paid" htmlFor="pay-date" required missing={required.shown && !dateOk}>
            <Input id="pay-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor="pay-note" hint="e.g. the bKash transaction ID.">
            <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <HandCoins />}
              Pay {Number.isFinite(money) && money > 0 ? formatMoney(money) : ""}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
