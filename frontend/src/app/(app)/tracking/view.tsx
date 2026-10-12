"use client"

import { useMemo, useState } from "react"
import { Ban, Check, ChevronRight, Plus, Search, Truck, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { attempt, useAttempt, ConfirmAction, EmptyState, Field, PageBody, PageHeader, SimpleSelect } from "@/components/common"
import { ClientPicker } from "@/components/client-dialog"
import { usePermissions, useScope } from "@/components/session-provider"
import { SHIPMENT_FLOW, SHIPMENT_STATUS, ShipmentStatusPill } from "@/components/status"
import { TrackingLinkShare, copyTrackingLink } from "@/components/tracking-link"
import { formatDateTime, formatMoney, timeAgo } from "@/lib/format"
import { qtyAt, useStore } from "@/lib/store"
import { useLookups } from "@/lib/store/hooks"
import type { Shipment, ShipmentStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const FILTERS: { value: "all" | ShipmentStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "in_delivery", label: "In delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "returned", label: "Returned" },
  { value: "cancelled", label: "Cancelled" },
]

const NEXT_LABEL: Partial<Record<ShipmentStatus, string>> = {
  pending: "Start processing",
  processing: "Send for delivery",
  in_delivery: "Mark delivered",
}

export function TrackingView() {
  const scope = useScope()
  const shipments = useStore((s) => s.shipments)
  const lookups = useLookups()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all")
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const mine = useMemo(() => shipments.filter((s) => scope.has(s.fromLocationId)), [shipments, scope])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: mine.length }
    for (const s of mine) c[s.status] = (c[s.status] ?? 0) + 1
    return c
  }, [mine])

  const q = query.trim().toLowerCase()
  const rows = mine.filter((s) => {
    if (filter !== "all" && s.status !== filter) return false
    if (!q) return true
    const hay = [s.code, lookups.product.get(s.productId)?.name, lookups.client.get(s.clientId)?.name, lookups.client.get(s.clientId)?.company]
    return hay.some((v) => v?.toLowerCase().includes(q))
  })
  const open = mine.find((s) => s.id === openId)

  return (
    <PageBody>
      <PageHeader
        title="Order tracking"
        description="See where every order is, from pending to delivered."
        actions={
          <Button onClick={() => setCreating(true)} disabled={scope.locations.length === 0}>
            <Plus />
            New order
          </Button>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0 lg:pb-0">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                filter === f.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {f.label}
              <span className={cn("text-xs tabular-nums", filter === f.value ? "opacity-80" : "text-muted-foreground")}>{counts[f.value] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search order, client, product…" className="h-9 pl-9" />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Truck} title="No orders here" description="Create an order to send products to a client and track it." />
      ) : (
        <div className="grid gap-3">
          {rows.map((s) => {
            const product = lookups.product.get(s.productId)
            const client = lookups.client.get(s.clientId)
            return (
              <Card key={s.id} className="cursor-pointer py-4 transition-shadow hover:shadow-md" onClick={() => setOpenId(s.id)}>
                <CardContent className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                      <ShipmentStatusPill status={s.status} />
                      <span className="text-xs text-muted-foreground">updated {timeAgo(s.history[s.history.length - 1].at)}</span>
                    </div>
                    <p className="truncate font-medium">
                      {s.quantity} × {product?.name ?? "Deleted product"}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      To {client?.name ?? "Unknown client"}
                      {client?.company ? ` · ${client.company}` : ""} · from {lookups.location.get(s.fromLocationId)?.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress status={s.status} />
                    <ChevronRight className="hidden size-4 text-muted-foreground md:block" />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">{open && <ShipmentDetail shipment={open} />}</SheetContent>
      </Sheet>

      {creating && <NewOrderDialog onClose={() => setCreating(false)} />}
    </PageBody>
  )
}

function Progress({ status }: { status: ShipmentStatus }) {
  const index = SHIPMENT_FLOW.indexOf(status)
  const off = index === -1
  return (
    <div className="flex items-center gap-1" aria-label={`Progress: ${SHIPMENT_STATUS[status].label}`}>
      {SHIPMENT_FLOW.map((step, i) => (
        <div key={step} className="flex items-center gap-1">
          <div
            title={SHIPMENT_STATUS[step].label}
            className={cn(
              "size-2.5 rounded-full",
              off ? "bg-muted-foreground/25" : i <= index ? (index === 3 ? "bg-emerald-500" : "bg-primary") : "bg-muted-foreground/25",
            )}
          />
          {i < SHIPMENT_FLOW.length - 1 && (
            <div className={cn("h-0.5 w-6 rounded-full sm:w-10", !off && i < index ? (index === 3 ? "bg-emerald-500" : "bg-primary") : "bg-muted-foreground/25")} />
          )}
        </div>
      ))}
    </div>
  )
}

function ShipmentDetail({ shipment: s }: { shipment: Shipment }) {
  const lookups = useLookups()
  const setStatus = useStore((st) => st.setShipmentStatus)
  const [note, setNote] = useState("")
  const product = lookups.product.get(s.productId)
  const client = lookups.client.get(s.clientId)
  const next = SHIPMENT_FLOW[SHIPMENT_FLOW.indexOf(s.status) + 1]
  const closed = s.status === "returned" || s.status === "cancelled"

  const move = (status: ShipmentStatus, msg: string) => {
    void attempt(() => setStatus(s.id, status, note.trim() || undefined), msg).then((ok) => ok && setNote(""))
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          {s.code} <ShipmentStatusPill status={s.status} />
        </SheetTitle>
        <SheetDescription>Created {formatDateTime(s.createdAt)}</SheetDescription>
      </SheetHeader>
      <div className="space-y-6 px-4 pb-6">
        <div className="grid gap-3 rounded-xl border p-4 text-sm">
          <Row label="Product" value={`${s.quantity} × ${product?.name ?? "Deleted product"}`} />
          {s.unitPrice !== null && <Row label="Price" value={`${formatMoney(s.unitPrice)} each · ${formatMoney(s.unitPrice * s.quantity)}`} />}
          <Row label="Client" value={client ? `${client.name}${client.company ? ` (${client.company})` : ""}` : "Unknown"} />
          {client?.phone && <Row label="Phone" value={client.phone} />}
          {client?.address && <Row label="Deliver to" value={client.address} />}
          <Row label="Ships from" value={lookups.location.get(s.fromLocationId)?.name ?? "—"} />
          {s.notes && <Row label="Notes" value={s.notes} />}
        </div>

        <TrackingLinkShare shipment={s} client={client} />

        {!closed && (
          <div className="space-y-3">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the next update (optional)" rows={2} />
            <div className="flex flex-wrap gap-2">
              {next && (
                <Button className="flex-1" onClick={() => move(next, `Marked as ${SHIPMENT_STATUS[next].label.toLowerCase()}`)}>
                  <Check />
                  {NEXT_LABEL[s.status]}
                </Button>
              )}
              {s.status === "delivered" && (
                <ConfirmAction
                  trigger={
                    <Button variant="outline" className="flex-1">
                      <Undo2 />
                      Client returned it
                    </Button>
                  }
                  title="Mark as returned?"
                  description={`${s.quantity} ${product?.unit ?? ""} will be added back to ${lookups.location.get(s.fromLocationId)?.name}.`}
                  confirmLabel="Mark returned"
                  onConfirm={() => move("returned", "Marked as returned and restocked")}
                />
              )}
              {s.status !== "delivered" && (
                <ConfirmAction
                  trigger={
                    <Button variant="outline" className="text-destructive">
                      <Ban />
                      Cancel order
                    </Button>
                  }
                  title="Cancel this order?"
                  description="The stock goes back to the location it was taken from."
                  confirmLabel="Cancel order"
                  destructive
                  onConfirm={() => move("cancelled", "Order cancelled and restocked")}
                />
              )}
            </div>
          </div>
        )}

        <div>
          <h3 className="mb-3 text-sm font-medium">History</h3>
          <ol className="relative space-y-4 border-l pl-5">
            {[...s.history].reverse().map((h, i) => (
              <li key={i} className="relative">
                <span className={cn("absolute top-1 -left-[25px] size-2.5 rounded-full ring-4 ring-background", i === 0 ? "bg-primary" : "bg-muted-foreground/40")} />
                <p className="text-sm font-medium">{SHIPMENT_STATUS[h.status].label}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(h.at)} · {h.by}
                </p>
                {h.note && <p className="mt-1 rounded-md bg-muted px-2 py-1 text-xs">{h.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}

function NewOrderDialog({ onClose }: { onClose: () => void }) {
  const scope = useScope()
  const products = useStore((s) => s.products)
  const stock = useStore((s) => s.stock)
  const createShipment = useStore((s) => s.createShipment)
  const [run, pending] = useAttempt()
  const links = usePermissions().module("trackingLinks")
  const [from, setFrom] = useState(scope.locations[0]?.id ?? "")
  const [clientId, setClientId] = useState("")
  const [productId, setProductId] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [price, setPrice] = useState("")
  const [notes, setNotes] = useState("")

  const available = productId ? qtyAt(stock, productId, from) : 0
  const qty = Number(quantity)
  const unitPrice = Number(price)
  const valid = from && clientId && productId && Number.isInteger(qty) && qty > 0 && qty <= available && price !== "" && unitPrice >= 0

  const chooseProduct = (id: string) => {
    setProductId(id)
    setPrice(String(products.find((p) => p.id === id)?.price ?? ""))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    let created: Shipment | undefined
    const ok = await run(async () => {
      created = await createShipment({ productId, quantity: qty, unitPrice, clientId, fromLocationId: from, notes: notes.trim() || undefined })
    })
    if (!ok || !created) return
    const order = created
    toast.success(`Order ${order.code} created`, {
      action: links ? { label: "Copy client link", onClick: () => void copyTrackingLink(order) } : undefined,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New order</DialogTitle>
            <DialogDescription>Stock is reserved as soon as the order is created.</DialogDescription>
          </DialogHeader>
          <Field label="Client">
            <ClientPicker value={clientId} onChange={setClientId} />
          </Field>
          <Field label="Ship from">
            <SimpleSelect
              value={from}
              onChange={(v) => {
                setFrom(v)
                setProductId("")
              }}
              options={scope.locations.map((l) => ({ value: l.id, label: l.name }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <Field label="Product">
              <SimpleSelect
                value={productId}
                onChange={chooseProduct}
                options={products.filter((p) => qtyAt(stock, p.id, from) > 0).map((p) => ({ value: p.id, label: `${p.name} (${qtyAt(stock, p.id, from)})` }))}
                placeholder="Choose product"
              />
            </Field>
            <Field label="Quantity" htmlFor="ord-qty" hint={productId ? `${available} available` : undefined}>
              <Input id="ord-qty" type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
          </div>
          <Field label="Price per unit" htmlFor="ord-price" hint={productId && price !== "" && qty > 0 ? `Order total ${formatMoney(qty * unitPrice)}. Recorded as a sale when delivered.` : "Recorded as a sale when the order is delivered."}>
            <Input id="ord-price" type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} disabled={!productId} />
          </Field>
          <Field label="Notes" htmlFor="ord-notes">
            <Textarea id="ord-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery instructions, invoice number…" rows={2} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              Create order
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
