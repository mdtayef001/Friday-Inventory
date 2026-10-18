"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, Pill, SimpleSelect, useAttempt, type PillTone } from "@/components/common"
import { actions } from "@/lib/data/actions"
import { useLocations } from "@/lib/data/queries"
import { formatMoney } from "@/lib/format"
import type { Purchase, PurchaseItem, RefundMethod, SupplierReturn, SupplierReturnStatus } from "@/lib/types"

// Stock sent back to a supplier. It leaves stock straight away; the supplier then
// sends replacements, refunds the money, or both. The owner can close one the
// supplier won't settle, and what's left is a loss.

export const RETURN_STATUS: Record<SupplierReturnStatus, { label: string; tone: PillTone }> = {
  open: { label: "Waiting for supplier", tone: "amber" },
  settled: { label: "Settled", tone: "green" },
  closed: { label: "Closed unsettled", tone: "red" },
}

export const REFUND_METHODS: Record<RefundMethod, string> = { cash: "Cash", mobile: "Mobile banking", bank: "Bank" }

export function ReturnStatusPill({ status }: { status: SupplierReturnStatus }) {
  return <Pill tone={RETURN_STATUS[status].tone}>{RETURN_STATUS[status].label}</Pill>
}

const REASONS = ["Broken", "Damaged in delivery", "Wrong item", "Expired", "Not working"]

/** Sends some of a purchase's product back to the supplier. */
export function ReturnToSupplierDialog({ purchase, item, onClose }: { purchase: Purchase; item: PurchaseItem; onClose: () => void }) {
  const [run, pending] = useAttempt()
  const left = item.quantity - item.returned
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState("")
  const location = useLocations().find((l) => l.id === purchase.locationId)?.name
  const valid = Number.isInteger(quantity) && quantity > 0 && quantity <= left && reason.trim() !== ""
  const value = quantity * item.unitCost

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    if (await run(() => actions.returnToSupplier(item.id, quantity, reason.trim()), "Return recorded. The stock is out.")) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Return to {purchase.supplier?.name ?? "supplier"}</DialogTitle>
            <DialogDescription>
              {item.productName} from {purchase.code} · paid {formatMoney(item.unitCost)} each · {left} of {item.quantity} can be returned
            </DialogDescription>
          </DialogHeader>
          <Field label="How many" htmlFor="ret-qty">
            <Input
              id="ret-qty"
              type="number"
              inputMode="numeric"
              min="1"
              max={left}
              step="1"
              value={quantity || ""}
              onChange={(e) => setQuantity(Math.floor(Number(e.target.value)) || 0)}
              aria-invalid={quantity > left}
              autoFocus
            />
          </Field>
          <Field label="What's wrong" htmlFor="ret-reason">
            <Input id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Broken screen" />
            <div className="mt-1 flex flex-wrap gap-1">
              {REASONS.map((r) => (
                <Button key={r} type="button" variant="outline" size="xs" onClick={() => setReason(r)}>
                  {r}
                </Button>
              ))}
            </div>
          </Field>
          <ul className="list-disc space-y-1 rounded-lg border p-3 pl-7 text-sm">
            <li>
              {quantity > 0 ? quantity : "They"} come out of stock{location ? ` at ${location}` : ""} now.
            </li>
            <li>
              The supplier owes you <strong>{formatMoney(Number.isFinite(value) ? value : 0)}</strong>, as new units, a refund, or both.
            </li>
            <li>The product&apos;s cost stays as it is.</li>
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending && <Loader2 className="animate-spin" />}
              Return {quantity > 0 ? quantity : ""} · {formatMoney(Number.isFinite(value) ? value : 0)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type SettleMode = "replacement" | "refund" | "credit" | "close"

/** The supplier settles a return: new units, money back, taken off what's owed, or the owner gives up on the rest. */
export function SettleReturnDialog({ ret: r, mode, onClose }: { ret: SupplierReturn; mode: SettleMode; onClose: () => void }) {
  const [run, pending] = useAttempt()
  const [quantity, setQuantity] = useState(r.unitsToReplace)
  const [amount, setAmount] = useState(String(r.outstanding))
  const [method, setMethod] = useState<RefundMethod>("cash")
  const [note, setNote] = useState("")
  const location = useLocations().find((l) => l.id === r.locationId)?.name
  const money = Number(amount)

  const valid =
    mode === "replacement"
      ? Number.isInteger(quantity) && quantity > 0 && quantity <= r.unitsToReplace
      : mode === "refund" || mode === "credit"
        ? amount !== "" && money > 0 && money <= r.outstanding
        : true

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    const done = {
      replacement: () => actions.receiveReplacement(r.id, quantity),
      refund: () => actions.receiveRefund(r.id, money, method),
      credit: () => actions.creditReturn(r.id, money),
      close: () => actions.closeReturn(r.id, note.trim()),
    }[mode]
    const message = {
      replacement: "Replacement received. The stock is back in.",
      refund: "Refund recorded.",
      credit: `Taken off what you owe ${r.supplier?.name ?? "the supplier"}.`,
      close: "Return closed.",
    }[mode]
    if (await run(done, message)) onClose()
  }

  const title = { replacement: "Replacement received", refund: "Refund received", credit: "Take off what I owe", close: "Close without settling" }[mode]
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {r.code} · {r.quantity} × {r.productName} · {r.supplier?.name ?? "No supplier"} still owes {formatMoney(r.outstanding)}
            </DialogDescription>
          </DialogHeader>
          {mode === "replacement" && (
            <Field label="How many arrived" htmlFor="set-qty" hint={`Up to ${r.unitsToReplace}. They go into stock${location ? ` at ${location}` : ""}.`}>
              <Input
                id="set-qty"
                type="number"
                inputMode="numeric"
                min="1"
                max={r.unitsToReplace}
                step="1"
                value={quantity || ""}
                onChange={(e) => setQuantity(Math.floor(Number(e.target.value)) || 0)}
                autoFocus
              />
            </Field>
          )}
          {mode === "refund" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount" htmlFor="set-amount" hint={`Up to ${formatMoney(r.outstanding)}.`}>
                <Input
                  id="set-amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max={r.outstanding}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="How it came" htmlFor="set-method">
                <SimpleSelect
                  id="set-method"
                  value={method}
                  onChange={(v) => setMethod(v as RefundMethod)}
                  options={Object.entries(REFUND_METHODS).map(([value, label]) => ({ value, label }))}
                />
              </Field>
            </div>
          )}
          {mode === "credit" && (
            <>
              <Field label="Amount" htmlFor="set-credit" hint={`Up to ${formatMoney(r.outstanding)}.`}>
                <Input
                  id="set-credit"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max={r.outstanding}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
              </Field>
              <p className="text-sm text-muted-foreground">
                Instead of money back, you owe {r.supplier?.name ?? "the supplier"} this much less. It comes off {r.purchaseCode} first, then the oldest
                unpaid bills.
              </p>
            </>
          )}
          {mode === "close" && (
            <>
              <p className="text-sm">
                The supplier won&apos;t settle the rest. <strong>{formatMoney(r.outstanding)}</strong> is written off as a loss, and the return is closed.
              </p>
              <Field label="Note" htmlFor="set-note" hint="Optional.">
                <Input id="set-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Supplier refused" autoFocus />
              </Field>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={mode === "close" ? "destructive" : "default"} disabled={!valid || pending}>
              {pending && <Loader2 className="animate-spin" />}
              {{ replacement: "Put back in stock", refund: "Record refund", credit: "Take it off", close: "Close return" }[mode]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
