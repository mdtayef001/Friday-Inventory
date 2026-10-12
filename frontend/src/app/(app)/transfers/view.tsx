"use client"

import { useState } from "react"
import { ArrowLeftRight, ArrowRight, Check, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { attempt, useAttempt, ConfirmAction, EmptyState, Field, PageBody, PageHeader, SimpleSelect } from "@/components/common"
import { useScope } from "@/components/session-provider"
import { TransferStatusPill } from "@/components/status"
import { formatDateTime } from "@/lib/format"
import { qtyAt, useStore } from "@/lib/store"
import { useLookups } from "@/lib/store/hooks"

export function TransfersView() {
  const scope = useScope()
  const transfers = useStore((s) => s.transfers)
  const receiveTransfer = useStore((s) => s.receiveTransfer)
  const cancelTransfer = useStore((s) => s.cancelTransfer)
  const lookups = useLookups()
  const [creating, setCreating] = useState(false)

  const rows = transfers.filter((t) => scope.has(t.fromLocationId) || scope.has(t.toLocationId))

  return (
    <PageBody>
      <PageHeader
        title="Transfers"
        description="Move stock between your warehouse and shops. Stock leaves when you send it and arrives when it's received."
        actions={
          <Button onClick={() => setCreating(true)} disabled={scope.locations.length === 0}>
            <Plus />
            New transfer
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="No transfers yet" description="Send stock from one location to another to see it here." />
      ) : (
        <Card className="py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Reference</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => {
                  const product = lookups.product.get(t.productId)
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="pl-4 font-mono text-xs">{t.code}</TableCell>
                      <TableCell>
                        <div className="font-medium">{product?.name ?? "Deleted product"}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.quantity} {product?.unit}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm whitespace-nowrap">
                          {lookups.location.get(t.fromLocationId)?.name ?? "—"}
                          <ArrowRight className="size-3.5 text-muted-foreground" />
                          {lookups.location.get(t.toLocationId)?.name ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <TransferStatusPill status={t.status} />
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                        {formatDateTime(t.createdAt)}
                        <div>by {t.createdBy}</div>
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        {t.status === "in_transit" && (
                          <div className="flex justify-end gap-1">
                            {scope.has(t.toLocationId) && (
                              <Button size="sm" onClick={() => attempt(() => receiveTransfer(t.id), "Transfer received")}>
                                <Check />
                                Receive
                              </Button>
                            )}
                            {scope.has(t.fromLocationId) && (
                              <ConfirmAction
                                trigger={
                                  <Button size="sm" variant="ghost" aria-label="Cancel transfer">
                                    <X />
                                  </Button>
                                }
                                title="Cancel this transfer?"
                                description="The stock goes back to the location it was sent from."
                                confirmLabel="Cancel transfer"
                                destructive
                                onConfirm={() => attempt(() => cancelTransfer(t.id), "Transfer cancelled")}
                              />
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {creating && <NewTransferDialog onClose={() => setCreating(false)} />}
    </PageBody>
  )
}

function NewTransferDialog({ onClose }: { onClose: () => void }) {
  const scope = useScope()
  const allLocations = useStore((s) => s.locations)
  const products = useStore((s) => s.products)
  const stock = useStore((s) => s.stock)
  const createTransfer = useStore((s) => s.createTransfer)
  const [from, setFrom] = useState(scope.locations[0]?.id ?? "")
  const [to, setTo] = useState("")
  const [productId, setProductId] = useState("")
  const [quantity, setQuantity] = useState("1")

  const available = productId && from ? qtyAt(stock, productId, from) : 0
  const productsHere = products.filter((p) => qtyAt(stock, p.id, from) > 0)
  const qty = Number(quantity)
  const valid = from && to && from !== to && productId && Number.isInteger(qty) && qty > 0 && qty <= available

  const [run, pending] = useAttempt()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    const ok = await run(() => createTransfer({ productId, quantity: qty, fromLocationId: from, toLocationId: to }), "Transfer sent")
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New transfer</DialogTitle>
            <DialogDescription>Stock is taken from the first location now and added to the second when received.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From">
              <SimpleSelect
                value={from}
                onChange={(v) => {
                  setFrom(v)
                  setProductId("")
                }}
                options={scope.locations.map((l) => ({ value: l.id, label: l.name }))}
              />
            </Field>
            <Field label="To">
              <SimpleSelect
                value={to}
                onChange={setTo}
                options={allLocations.filter((l) => l.id !== from).map((l) => ({ value: l.id, label: l.name }))}
                placeholder="Choose destination"
              />
            </Field>
          </div>
          <Field label="Product" hint={productsHere.length === 0 ? "Nothing in stock at this location." : undefined}>
            <SimpleSelect
              value={productId}
              onChange={setProductId}
              options={productsHere.map((p) => ({ value: p.id, label: `${p.name} (${qtyAt(stock, p.id, from)} ${p.unit})` }))}
              placeholder="Choose product"
            />
          </Field>
          <Field label="Quantity" htmlFor="tr-qty" hint={productId ? `${available} available` : undefined}>
            <Input id="tr-qty" type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              Send transfer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
