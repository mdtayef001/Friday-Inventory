"use client"

import { useState } from "react"
import { format } from "date-fns"
import { Loader2, PackagePlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, SimpleSelect, useAttempt } from "@/components/common"
import { ProductPicker } from "@/components/product-picker"
import { useScope } from "@/components/session-provider"
import { SupplierPicker } from "@/components/supplier-dialog"
import { actions } from "@/lib/data/actions"
import { formatMoney } from "@/lib/format"
import type { Product, SupplierBrief } from "@/lib/types"

/** One product on the bill. The cost is kept as typed, so the field can be cleared while editing. */
interface PurchaseLine {
  product: Product
  quantity: number
  unitCost: string
}

const today = () => format(new Date(), "yyyy-MM-dd")

/**
 * Records stock bought from a supplier: the products and what was paid for each,
 * all received at one location. Saving puts them into stock there and averages
 * the price paid into each product's cost.
 */
export function PurchaseDialog({ onClose, supplier: initialSupplier = null }: { onClose: () => void; supplier?: SupplierBrief | null }) {
  const { locations } = useScope()
  const [run, pending] = useAttempt()
  const [supplier, setSupplier] = useState<SupplierBrief | null>(initialSupplier)
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "")
  const [lines, setLines] = useState<PurchaseLine[]>([])
  const [reference, setReference] = useState("")
  const [date, setDate] = useState(today)
  const [note, setNote] = useState("")

  const update = (i: number, patch: Partial<PurchaseLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const remove = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i))
  function add(product: Product) {
    // The same product again adds to its line instead of a second one.
    const at = lines.findIndex((l) => l.product.id === product.id)
    if (at >= 0) update(at, { quantity: lines[at].quantity + 1 })
    else setLines((ls) => [...ls, { product, quantity: 1, unitCost: String(product.cost) }])
  }

  const total = lines.reduce((sum, l) => sum + l.quantity * Number(l.unitCost), 0)
  const valid =
    !!locationId &&
    lines.length > 0 &&
    lines.every((l) => Number.isInteger(l.quantity) && l.quantity > 0 && l.unitCost !== "" && Number(l.unitCost) >= 0) &&
    !!date &&
    date <= today()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    const ok = await run(
      () =>
        actions.recordPurchase({
          supplierId: supplier?.id ?? null,
          locationId,
          items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitCost: Number(l.unitCost) })),
          reference: reference.trim(),
          note: note.trim(),
          // Today means now; an earlier day is recorded at midday so time zones can't move it a day.
          purchasedAt: date === today() ? undefined : new Date(`${date}T12:00:00`).toISOString(),
        }),
      "Purchase saved. The stock is in.",
    )
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New purchase</DialogTitle>
            <DialogDescription>Stock you bought. It goes into stock where it arrives, and each product&apos;s cost is updated.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier" hint="Optional.">
              <SupplierPicker value={supplier} onChange={setSupplier} allowNone />
            </Field>
            <Field label="Arrives at">
              <SimpleSelect value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
            </Field>
          </div>

          <Field label="Products">
            <ProductPicker value={null} onChange={add} placeholder="Add a product…" describe={(p) => `Cost ${formatMoney(p.cost)}`} />
          </Field>
          {lines.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Add the products on the supplier&apos;s bill.</p>
          ) : (
            <ul className="grid gap-3">
              {lines.map((line, i) => (
                <PurchaseRow key={line.product.id} index={i} line={line} onChange={(patch) => update(i, patch)} onRemove={() => remove(i)} />
              ))}
            </ul>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier's bill number" htmlFor="pur-ref" hint="Optional.">
              <Input id="pur-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} autoComplete="off" placeholder="e.g. INV-1182" />
            </Field>
            <Field label="Date bought" htmlFor="pur-date">
              <Input id="pur-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Note" htmlFor="pur-note" hint="Optional." className="sm:col-span-2">
              <Input id="pur-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </Field>
          </div>

          <div className="flex justify-between rounded-xl border bg-muted/30 p-3 text-sm font-medium">
            <span>Total paid</span>
            <span className="tabular-nums">{Number.isFinite(total) ? formatMoney(total) : "—"}</span>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending ? <Loader2 className="animate-spin" /> : <PackagePlus />}
              Save purchase {lines.length > 0 && Number.isFinite(total) ? `· ${formatMoney(total)}` : ""}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PurchaseRow({
  index,
  line,
  onChange,
  onRemove,
}: {
  index: number
  line: PurchaseLine
  onChange: (patch: Partial<PurchaseLine>) => void
  onRemove: () => void
}) {
  const { product } = line
  const cost = Number(line.unitCost)
  const amount = line.quantity * cost
  return (
    <li className="grid gap-2 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{product.name}</p>
          <p className="text-xs text-muted-foreground">
            {product.sku} · cost now {formatMoney(product.cost)}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${product.name}`}>
          <X />
        </Button>
      </div>
      <div className="grid grid-cols-[5rem_1fr_auto] items-end gap-2">
        <Field label={`Qty (${product.unit})`} htmlFor={`pur-qty-${index}`}>
          <Input
            id={`pur-qty-${index}`}
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={line.quantity || ""}
            onChange={(e) => onChange({ quantity: Math.floor(Number(e.target.value)) || 0 })}
          />
        </Field>
        <Field label="Paid per unit" htmlFor={`pur-cost-${index}`}>
          <Input
            id={`pur-cost-${index}`}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={line.unitCost}
            onChange={(e) => onChange({ unitCost: e.target.value })}
          />
        </Field>
        <p className="pb-2 text-right text-sm font-medium tabular-nums">{Number.isFinite(amount) ? formatMoney(amount) : "—"}</p>
      </div>
    </li>
  )
}
