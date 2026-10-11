"use client"

import { useState } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { qtyAt, useStore } from "@/lib/store"
import { attempt, Field, SimpleSelect } from "./common"
import { useScope, useSessionUser } from "./session-provider"

const REASONS = {
  add: ["New delivery from supplier", "Customer return", "Stock count correction", "Other"],
  remove: ["Sold in store", "Damaged / broken", "Lost or stolen", "Stock count correction", "Other"],
}

export function StockAdjustDialog({
  productId,
  locationId: initialLocation,
  open,
  onOpenChange,
}: {
  productId: string
  locationId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const user = useSessionUser()
  const { locations } = useScope()
  const product = useStore((s) => s.products.find((p) => p.id === productId))
  const stock = useStore((s) => s.stock)
  const adjustStock = useStore((s) => s.adjustStock)
  const [mode, setMode] = useState<"add" | "remove">("add")
  const [locationId, setLocationId] = useState(initialLocation ?? locations[0]?.id ?? "")
  const [quantity, setQuantity] = useState("1")
  const [reason, setReason] = useState(REASONS.add[0])

  if (!product) return null
  const current = qtyAt(stock, productId, locationId)
  const qty = Number(quantity)
  const valid = Number.isInteger(qty) && qty > 0 && !!locationId && (mode === "add" || qty <= current)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || !product) return
    const ok = attempt(
      () => adjustStock(productId, locationId, mode === "add" ? qty : -qty, reason, user.name),
      mode === "add" ? `Added ${qty} ${product.unit}` : `Removed ${qty} ${product.unit}`,
    )
    if (ok) {
      setQuantity("1")
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Update stock</DialogTitle>
            <DialogDescription>{product.name}</DialogDescription>
          </DialogHeader>
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as "add" | "remove")
              setReason(REASONS[v as "add" | "remove"][0])
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="add">
                <Plus />
                Add stock
              </TabsTrigger>
              <TabsTrigger value="remove">
                <Minus />
                Remove stock
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Field label="Location" hint={`Currently ${current} ${product.unit} here`}>
            <SimpleSelect value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
          <Field label="Quantity" htmlFor="adjust-qty">
            <Input id="adjust-qty" type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
          </Field>
          <Field label="Reason">
            <SimpleSelect value={reason} onChange={setReason} options={REASONS[mode].map((r) => ({ value: r, label: r }))} />
          </Field>
          {mode === "remove" && qty > current && <p className="text-sm text-destructive">Only {current} available at this location.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid} variant={mode === "remove" ? "destructive" : "default"}>
              {mode === "add" ? "Add" : "Remove"} {Number.isFinite(qty) && qty > 0 ? qty : ""} {product.unit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
