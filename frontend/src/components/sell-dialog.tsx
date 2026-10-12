"use client"

import { useState } from "react"
import { ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ClientPicker } from "@/components/client-dialog"
import { Field, SimpleSelect, useAttempt } from "@/components/common"
import { usePermissions, useScope, useSessionUser } from "@/components/session-provider"
import { formatMoney } from "@/lib/format"
import { qtyAt, useStore } from "@/lib/store"

/**
 * A walk-in sale: takes the stock and records the money at the price agreed now.
 * The price starts at the product's selling price and can be changed or discounted.
 */
export function SellDialog({
  productId,
  locationId: initialLocation,
  quantity: initialQuantity = 1,
  onClose,
  onSold,
}: {
  productId: string
  locationId?: string
  quantity?: number
  onClose: () => void
  onSold?: () => void
}) {
  const user = useSessionUser()
  const { locations } = useScope()
  const product = useStore((s) => s.products.find((p) => p.id === productId))
  const stock = useStore((s) => s.stock)
  const sell = useStore((s) => s.sell)
  const [run, pending] = useAttempt()
  const showProfit = usePermissions().can("managerProfit")
  const [locationId, setLocationId] = useState(initialLocation ?? locations.find((l) => qtyAt(stock, productId, l.id) > 0)?.id ?? locations[0]?.id ?? "")
  const [quantity, setQuantity] = useState(String(initialQuantity))
  const [price, setPrice] = useState(String(product?.price ?? ""))
  const [discount, setDiscount] = useState("")
  const [clientId, setClientId] = useState("")

  if (!product) return null
  const available = qtyAt(stock, product.id, locationId)
  const qty = Number(quantity)
  const unitPrice = Number(price)
  const off = Number(discount) || 0
  const total = qty * unitPrice - off
  const valid =
    !!locationId && Number.isInteger(qty) && qty > 0 && qty <= available && price !== "" && unitPrice >= 0 && off >= 0 && total >= 0
  // Staff don't see the client list, so they sell without one.
  const canPickClient = user.role !== "staff"

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || !product) return
    const ok = await run(
      () => sell({ productId: product.id, locationId, quantity: qty, unitPrice, discount: off, clientId: clientId || undefined }),
      `Sold ${qty} ${product.unit} of ${product.name} for ${formatMoney(total)}`,
    )
    if (ok) {
      onSold?.()
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Sell</DialogTitle>
            <DialogDescription>{product.name}</DialogDescription>
          </DialogHeader>
          <Field label="Sold from" hint={`${available} ${product.unit} available here`}>
            <SimpleSelect value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Quantity" htmlFor="sell-qty">
              <Input id="sell-qty" type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
            </Field>
            <Field label="Price per unit" htmlFor="sell-price" hint={unitPrice !== product.price && price !== "" ? `List price ${formatMoney(product.price)}` : undefined}>
              <Input id="sell-price" type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
          </div>
          <Field label="Discount" htmlFor="sell-discount" hint="Taken off the total. Optional.">
            <Input id="sell-discount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          {canPickClient && (
            <Field label="Client" hint="Optional. Leave empty for a walk-in customer.">
              <ClientPicker value={clientId} onChange={setClientId} />
            </Field>
          )}
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span className="tabular-nums">{Number.isFinite(total) ? formatMoney(Math.max(0, total)) : "—"}</span>
            </div>
            {showProfit && Number.isFinite(total) && qty > 0 && (
              <div className="mt-1 flex justify-between text-muted-foreground">
                <span>Profit</span>
                <span className="tabular-nums">{formatMoney(total - qty * product.cost)}</span>
              </div>
            )}
          </div>
          {qty > available && <p className="text-sm text-destructive">Only {available} available at this location.</p>}
          {off > qty * unitPrice && <p className="text-sm text-destructive">The discount can&apos;t be more than the total.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              <ShoppingCart />
              Sell {Number.isFinite(total) && total >= 0 ? `· ${formatMoney(total)}` : ""}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
