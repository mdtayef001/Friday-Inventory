"use client"

import { useState } from "react"
import Link from "next/link"
import { useQueries } from "@tanstack/react-query"
import { CheckCircle2, Loader2, Printer, ShoppingCart, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ClientPicker } from "@/components/client-dialog"
import { Field, SimpleSelect, useAttempt } from "@/components/common"
import { PaymentPicker } from "@/components/payment-picker"
import { ReceiptShare } from "@/components/receipt-share"
import { useBusiness, usePermissions, useScope, useSessionUser } from "@/components/session-provider"
import { PAYMENT_METHODS } from "@/lib/business"
import { actions } from "@/lib/data/actions"
import { apiQuery, qtyAt, useProduct } from "@/lib/data/queries"
import { formatMoney } from "@/lib/format"
import type { ClientBrief, PaymentMethod, Product, Sale } from "@/lib/types"

/** One item on the bill. The price is kept as typed, so the field can be cleared while editing. */
export interface CheckoutLine {
  productId: string
  name: string
  quantity: number
  unitPrice: string
}

export function lineFor(product: Pick<Product, "id" | "name" | "price">, quantity = 1): CheckoutLine {
  return { productId: product.id, name: product.name, quantity, unitPrice: String(product.price) }
}

/** Sells one product: a checkout with just that item. */
export function SellDialog({
  productId,
  locationId,
  quantity = 1,
  onClose,
  onSold,
}: {
  productId: string
  locationId?: string
  quantity?: number
  onClose: () => void
  onSold?: () => void
}) {
  const product = useProduct(productId).data
  const [lines, setLines] = useState<CheckoutLine[] | null>(null)
  if (!product) return null
  return (
    <CheckoutDialog
      lines={lines ?? [lineFor(product, quantity)]}
      onLinesChange={setLines}
      initialLocation={locationId}
      onClose={onClose}
      onSold={onSold}
    />
  )
}

/**
 * A walk-in checkout: one or more items from one shop, one discount on the whole
 * bill, one payment and one receipt. Takes the stock and records the money at the
 * prices agreed now; each price starts at the product's selling price and can be
 * changed. Once sold, it shows the receipt to print or send to the buyer.
 *
 * The lines are owned by the caller (the cart keeps them while you browse).
 */
export function CheckoutDialog({
  lines,
  onLinesChange,
  initialLocation,
  onClose,
  onSold,
}: {
  lines: CheckoutLine[]
  onLinesChange: (lines: CheckoutLine[]) => void
  initialLocation?: string
  onClose: () => void
  onSold?: () => void
}) {
  const user = useSessionUser()
  const { locations } = useScope()
  const [run, pending] = useAttempt()
  const showProfit = usePermissions().can("managerProfit")
  // Loaded fresh, so the stock shown is what's there now.
  const products = useQueries({ queries: lines.map((l) => apiQuery<Product>(`products/${l.productId}/`)) })
  const productFor = (i: number) => products[i]?.data
  const [locationId, setLocationId] = useState(
    initialLocation ?? locations.find((l) => products.every((p) => !p.data || qtyAt(p.data, l.id) > 0))?.id ?? locations[0]?.id ?? "",
  )
  const [discount, setDiscount] = useState("")
  const [client, setClient] = useState<ClientBrief | null>(null)
  const [method, setMethod] = useState<PaymentMethod>("cash")
  const [received, setReceived] = useState(false)
  const [reference, setReference] = useState("")
  const [sold, setSold] = useState<Sale | null>(null)
  // Called on the way out, not straight after the sale: the scan page unmounts this dialog in onSold.
  const finish = () => {
    onSold?.()
    onClose()
  }

  if (sold) return <Sold sale={sold} client={client} onDone={finish} />

  const update = (i: number, patch: Partial<CheckoutLine>) => onLinesChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const remove = (i: number) => onLinesChange(lines.filter((_, j) => j !== i))
  // The same product twice draws on the same stock.
  const wanted = (productId: string) => lines.filter((l) => l.productId === productId).reduce((n, l) => n + l.quantity, 0)
  const short = lines.some((l, i) => productFor(i) && wanted(l.productId) > qtyAt(productFor(i), locationId))
  const subtotal = lines.reduce((sum, l) => sum + l.quantity * Number(l.unitPrice), 0)
  const cost = lines.reduce((sum, l, i) => sum + l.quantity * (productFor(i)?.cost ?? 0), 0)
  const off = Number(discount) || 0
  const total = subtotal - off
  // Card machines are checked by a person, so they tick that it went through.
  // Mobile banking needs the transaction ID from the customer's payment instead.
  const needsConfirm = method === "card"
  const valid =
    !!locationId &&
    lines.length > 0 &&
    products.every((p) => p.data) &&
    lines.every((l) => Number.isInteger(l.quantity) && l.quantity > 0 && l.unitPrice !== "" && Number(l.unitPrice) >= 0) &&
    !short &&
    off >= 0 &&
    total >= 0 &&
    (!needsConfirm || received) &&
    (method !== "mobile" || reference.trim() !== "")
  // Staff don't see the client list, so they sell without one.
  const canPickClient = user.role !== "staff"
  const single = lines.length === 1

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    let sale: Sale | undefined
    // No toast: the Sold screen says it went through.
    const ok = await run(async () => {
      sale = await actions.sell({
        locationId,
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: Number(l.unitPrice) })),
        discount: off,
        clientId: client?.id,
        paymentMethod: method,
        paymentReference: method === "mobile" ? reference.trim() : undefined,
      })
    })
    if (ok && sale) setSold(sale)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{single ? "Sell" : "Checkout"}</DialogTitle>
            <DialogDescription>{single ? lines[0]?.name : `${lines.length} items on one receipt`}</DialogDescription>
          </DialogHeader>
          <Field label="Sold from">
            <SimpleSelect value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
          {lines.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">The cart is empty.</p>
          ) : (
            <ul className="grid gap-3">
              {lines.map((line, i) => (
                <CheckoutRow
                  key={`${line.productId}-${i}`}
                  index={i}
                  line={line}
                  product={productFor(i)}
                  available={qtyAt(productFor(i), locationId)}
                  over={!!productFor(i) && wanted(line.productId) > qtyAt(productFor(i), locationId)}
                  onChange={(patch) => update(i, patch)}
                  onRemove={single ? undefined : () => remove(i)}
                  autoFocus={single}
                />
              ))}
            </ul>
          )}
          <Field label="Discount" htmlFor="sell-discount" hint={single ? "Taken off the total. Optional." : "One discount on the whole bill. Optional."}>
            <Input id="sell-discount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          {canPickClient && (
            <Field label="Client" hint="Optional. Leave empty for a walk-in customer.">
              <ClientPicker value={client} onChange={setClient} />
            </Field>
          )}
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            {!single && off > 0 && Number.isFinite(subtotal) && (
              <div className="mb-1 flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatMoney(subtotal)}</span>
              </div>
            )}
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span className="tabular-nums">{Number.isFinite(total) ? formatMoney(Math.max(0, total)) : "—"}</span>
            </div>
            {showProfit && Number.isFinite(total) && lines.length > 0 && (
              <div className="mt-1 flex justify-between text-muted-foreground">
                <span>Profit</span>
                <span className="tabular-nums">{formatMoney(total - cost)}</span>
              </div>
            )}
          </div>
          <PaymentPicker
            value={method}
            onChange={(m) => {
              setMethod(m)
              setReceived(false)
            }}
          />
          {method === "mobile" && (
            <Field label="Transaction ID" htmlFor="sell-trx" hint="From the bKash / Nagad payment message. It goes on the receipt.">
              <Input id="sell-trx" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} autoComplete="off" placeholder="e.g. 9AB3CD7XYZ" />
            </Field>
          )}
          {needsConfirm && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={received} onCheckedChange={(on) => setReceived(on === true)} />
              The card payment went through
            </label>
          )}
          {off > subtotal && <p className="text-sm text-destructive">The discount can&apos;t be more than the total.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {single ? "Cancel" : "Keep shopping"}
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending ? <Loader2 className="animate-spin" /> : <ShoppingCart />}
              Sell {Number.isFinite(total) && total >= 0 ? `· ${formatMoney(total)}` : ""}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CheckoutRow({
  index,
  line,
  product,
  available,
  over,
  onChange,
  onRemove,
  autoFocus,
}: {
  index: number
  line: CheckoutLine
  product: Product | undefined
  available: number
  over: boolean
  onChange: (patch: Partial<CheckoutLine>) => void
  onRemove?: () => void
  autoFocus?: boolean
}) {
  const price = Number(line.unitPrice)
  return (
    <li className="grid gap-2 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{line.name}</p>
          <p className={over ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
            {product ? `${available} ${product.unit} available here` : "Checking stock…"}
          </p>
        </div>
        {onRemove && (
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${line.name}`}>
            <X />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[5rem_1fr] items-end gap-2">
        <Field label="Qty" htmlFor={`sell-qty-${index}`}>
          <Input
            id={`sell-qty-${index}`}
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={line.quantity || ""}
            onChange={(e) => onChange({ quantity: Math.floor(Number(e.target.value)) || 0 })}
            autoFocus={autoFocus}
          />
        </Field>
        <Field label="Price per unit" htmlFor={`sell-price-${index}`} hint={product && line.unitPrice !== "" && price !== product.price ? `List price ${formatMoney(product.price)}` : undefined}>
          <Input id={`sell-price-${index}`} type="number" inputMode="decimal" min="0" step="0.01" value={line.unitPrice} onChange={(e) => onChange({ unitPrice: e.target.value })} />
        </Field>
      </div>
    </li>
  )
}

/** "2 × TV, 3 × Radio · ৳1,170" for the checkout's sales. */
function billSummary(sale: Sale) {
  const sales = sale.sales ?? [sale]
  const total = sales.reduce((sum, s) => sum + s.revenue, 0)
  return `${sales.map((s) => `${s.quantity} × ${s.productName}`).join(", ")} · ${formatMoney(total)}`
}

/** The sale went through: the receipt to print or send. */
function Sold({ sale, client, onDone }: { sale: Sale; client: ClientBrief | null; onDone: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sold</DialogTitle>
          <DialogDescription>{billSummary(sale)}</DialogDescription>
        </DialogHeader>
        <div className="grid justify-items-center gap-2 py-2 text-center">
          <CheckCircle2 className="size-10 text-emerald-500" />
          {sale.paymentMethod && (
            <p className="text-sm">
              Paid by {PAYMENT_METHODS[sale.paymentMethod].short.toLowerCase()}
              {sale.paymentReference && <span className="font-mono"> · {sale.paymentReference}</span>}.
            </p>
          )}
        </div>
        <ReceiptActions sale={sale} client={client} />
        <DialogFooter>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Print the receipt, or send the buyer its link. */
function ReceiptActions({ sale, client }: { sale: Sale; client: ClientBrief | null }) {
  const business = useBusiness()
  if (!sale.receiptNo || !sale.receiptToken) return null
  return (
    <div className="grid gap-3">
      <Button variant="outline" render={<Link href={`/receipt/${sale.id}`} target="_blank" />} nativeButton={false}>
        <Printer />
        Print receipt {sale.receiptNo}
      </Button>
      <ReceiptShare token={sale.receiptToken} receiptNo={sale.receiptNo} businessName={business.name} client={client} />
    </div>
  )
}
