"use client"

import { useState } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { actions } from "@/lib/data/actions"
import { qtyAt, useProduct } from "@/lib/data/queries"
import { useAttempt, useRequired, Field, SimpleSelect } from "./common"
import { useScope } from "./session-provider"

const REASONS = {
  add: ["New delivery from supplier", "Customer return", "Stock count correction", "Other"],
  // Selling goes through Sell, so the money is recorded too.
  remove: ["Damaged / broken", "Lost or stolen", "Stock count correction", "Other"],
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
  const { locations } = useScope()
  // Loaded fresh, so the current count is right even if someone else just changed it.
  const product = useProduct(productId).data
  const [mode, setMode] = useState<"add" | "remove">("add")
  const [locationId, setLocationId] = useState(initialLocation ?? locations[0]?.id ?? "")
  const [quantity, setQuantity] = useState("1")
  const [reason, setReason] = useState(REASONS.add[0])
  const [run, pending] = useAttempt()
  const required = useRequired()

  if (!product) return null
  const current = qtyAt(product, locationId)
  const qty = Number(quantity)
  const qtyOk = Number.isInteger(qty) && qty > 0 && (mode === "add" || qty <= current)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!product || !required.check(qtyOk && !!locationId, e)) return
    const ok = await run(
      () => actions.adjustStock(productId, locationId, mode === "add" ? qty : -qty, reason),
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
          <Field label="Location" required missing={required.shown && !locationId} hint={`Currently ${current} ${product.unit} here`}>
            <SimpleSelect value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
          <Field label="Quantity" htmlFor="adjust-qty" required missing={required.shown && !qtyOk}>
            <Input id="adjust-qty" type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
          </Field>
          <Field label="Reason" required>
            <SimpleSelect value={reason} onChange={setReason} options={REASONS[mode].map((r) => ({ value: r, label: r }))} />
          </Field>
          {mode === "remove" && qty > current && <p className="text-sm text-destructive">Only {current} available at this location.</p>}
          {mode === "remove" && <p className="text-xs text-muted-foreground">Selling it? Use Sell instead, so the sale and its price are recorded.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} variant={mode === "remove" ? "destructive" : "default"}>
              {mode === "add" ? "Add" : "Remove"} {Number.isFinite(qty) && qty > 0 ? qty : ""} {product.unit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
