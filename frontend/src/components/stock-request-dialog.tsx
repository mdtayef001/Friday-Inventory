"use client"

import { useState } from "react"
import { PackagePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, SimpleSelect, useAttempt } from "@/components/common"
import { useScope } from "@/components/session-provider"
import { qtyAt, useStore } from "@/lib/store"

/** A shop asks the warehouse (or another shop) for stock. */
export function RequestStockDialog({ productId: initialProduct, locationId: initialLocation, onClose }: { productId?: string; locationId?: string; onClose: () => void }) {
  const { locations } = useScope()
  const products = useStore((s) => s.products)
  const stock = useStore((s) => s.stock)
  const requestStock = useStore((s) => s.requestStock)
  const [run, pending] = useAttempt()
  const [productId, setProductId] = useState(initialProduct ?? "")
  const [locationId, setLocationId] = useState(
    initialLocation && locations.some((l) => l.id === initialLocation) ? initialLocation : (locations.find((l) => l.type === "outlet") ?? locations[0])?.id ?? "",
  )
  const product = products.find((p) => p.id === productId)
  const [quantity, setQuantity] = useState(product ? String(Math.max(1, product.lowStockThreshold * 2 - qtyAt(stock, product.id, locationId))) : "1")
  const [note, setNote] = useState("")
  const qty = Number(quantity)
  const valid = !!productId && !!locationId && Number.isInteger(qty) && qty > 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    const ok = await run(() => requestStock({ productId, quantity: qty, toLocationId: locationId, note: note.trim() }), "Request sent. You'll see it here when it's approved.")
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
          <Field label="Product">
            <SimpleSelect value={productId} onChange={setProductId} options={products.map((p) => ({ value: p.id, label: p.name }))} placeholder="Choose product" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="For" hint={product && locationId ? `${qtyAt(stock, product.id, locationId)} ${product.unit} there now` : undefined}>
              <SimpleSelect value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
            </Field>
            <Field label="Quantity" htmlFor="req-qty">
              <Input id="req-qty" type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
          </div>
          <Field label="Note" htmlFor="req-note" hint="Optional, e.g. why you need it.">
            <Input id="req-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              <PackagePlus />
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
