"use client"

import { useState } from "react"
import { PackagePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, SimpleSelect, useAttempt, useRequired } from "@/components/common"
import { ProductPicker } from "@/components/product-picker"
import { useScope } from "@/components/session-provider"
import { actions } from "@/lib/data/actions"
import { qtyAt, useProduct } from "@/lib/data/queries"
import type { Product } from "@/lib/types"

/** A shop asks the warehouse (or another shop) for stock. */
export function RequestStockDialog({ productId: initialProduct, locationId: initialLocation, onClose }: { productId?: string; locationId?: string; onClose: () => void }) {
  const { locations } = useScope()
  const [run, pending] = useAttempt()
  const required = useRequired()
  const [picked, setPicked] = useState<Product | null>(null)
  // Started from a product (e.g. the dashboard's low stock list): load it for its stock.
  const initial = useProduct(picked ? null : initialProduct).data
  const product = picked ?? initial ?? null
  const productId = product?.id ?? ""
  const [locationId, setLocationId] = useState(
    initialLocation && locations.some((l) => l.id === initialLocation) ? initialLocation : (locations.find((l) => l.type === "outlet") ?? locations[0])?.id ?? "",
  )
  const [typed, setQuantity] = useState<string | null>(null)
  // Suggest enough to get back to twice the low-stock level.
  const quantity = typed ?? (product ? String(Math.max(1, product.lowStockThreshold * 2 - qtyAt(product, locationId))) : "1")
  const [note, setNote] = useState("")
  const qty = Number(quantity)
  const qtyOk = Number.isInteger(qty) && qty > 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!required.check(!!productId && !!locationId && qtyOk, e)) return
    const ok = await run(() => actions.requestStock({ productId, quantity: qty, toLocationId: locationId, note: note.trim() }), "Request sent. You'll see it here when it's approved.")
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Request stock</DialogTitle>
            <DialogDescription>Ask for stock to be sent to your shop. The owner or the warehouse approves it.</DialogDescription>
          </DialogHeader>
          <Field label="Product" required missing={required.shown && !productId}>
            <ProductPicker
              value={product}
              onChange={(p) => {
                setPicked(p)
                setQuantity(null)
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="For" required missing={required.shown && !locationId} hint={product && locationId ? `${qtyAt(product, locationId)} ${product.unit} there now` : undefined}>
              <SimpleSelect value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
            </Field>
            <Field label="Quantity" htmlFor="req-qty" required missing={required.shown && !qtyOk}>
              <Input id="req-qty" type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
          </div>
          <Field label="Note" htmlFor="req-note" hint="e.g. why you need it.">
            <Input id="req-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              <PackagePlus />
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
