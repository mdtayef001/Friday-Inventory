"use client"

import { useState } from "react"
import { ArrowLeftRight, ArrowRight, Check, Inbox, PackagePlus, Plus, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { attempt, useAttempt, ConfirmAction, EmptyState, Field, PageBody, PageHeader, Pill, SimpleSelect, type PillTone } from "@/components/common"
import { useScope, useSessionUser } from "@/components/session-provider"
import { RequestStockDialog } from "@/components/stock-request-dialog"
import { TransferStatusPill } from "@/components/status"
import { formatDateTime, timeAgo } from "@/lib/format"
import type { StockRequest } from "@/lib/types"
import { qtyAt, useStore } from "@/lib/store"
import { useLookups } from "@/lib/store/hooks"

export function TransfersView() {
  const scope = useScope()
  const transfers = useStore((s) => s.transfers)
  const receiveTransfer = useStore((s) => s.receiveTransfer)
  const cancelTransfer = useStore((s) => s.cancelTransfer)
  const lookups = useLookups()
  const [creating, setCreating] = useState(false)
  const [requesting, setRequesting] = useState(false)

  const rows = transfers.filter((t) => scope.has(t.fromLocationId) || scope.has(t.toLocationId))

  return (
    <PageBody>
      <PageHeader
        title="Transfers"
        description="Move stock between your warehouse and shops. Stock leaves when you send it and arrives when it's received."
        actions={
          <>
            <Button variant="outline" onClick={() => setRequesting(true)} disabled={scope.locations.length === 0}>
              <PackagePlus />
              Request stock
            </Button>
            <Button onClick={() => setCreating(true)} disabled={scope.locations.length === 0}>
              <Plus />
              New transfer
            </Button>
          </>
        }
      />

      <StockRequests />
      {requesting && <RequestStockDialog onClose={() => setRequesting(false)} />}

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

const STAGE: Record<StockRequest["stage"], { label: string; tone: PillTone }> = {
  pending: { label: "Waiting", tone: "amber" },
  approved: { label: "Sent", tone: "blue" },
  in_transit: { label: "On the way", tone: "blue" },
  received: { label: "Arrived", tone: "green" },
  declined: { label: "Declined", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
}

/** Who may approve or decline: the owner, or a manager other than the one who asked. */
function useCanDecide() {
  const me = useSessionUser()
  return (r: StockRequest) => me.role === "owner" || (me.role === "manager" && r.requestedById !== me.id)
}

/** Requests from shops: waiting ones first, then the most recent 15 handled ones. */
function StockRequests() {
  const me = useSessionUser()
  const requests = useStore((s) => s.stockRequests)
  const cancelRequest = useStore((s) => s.cancelRequest)
  const lookups = useLookups()
  const canDecide = useCanDecide()
  const [approving, setApproving] = useState<StockRequest | null>(null)
  const [declining, setDeclining] = useState<StockRequest | null>(null)

  const waiting = requests.filter((r) => r.status === "pending")
  const handled = requests.filter((r) => r.status !== "pending").slice(0, 15)
  const rows = [...waiting, ...handled]
  if (rows.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Inbox className="size-4" />
          Stock requests
          {waiting.length > 0 && <Pill tone="amber">{waiting.length} waiting</Pill>}
        </CardTitle>
        <CardDescription>Shops asking for stock. Approving one sends a transfer from the location you pick.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Request</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Asked by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const product = r.productId ? lookups.product.get(r.productId) : undefined
                const mine = r.requestedById === me.id
                return (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4">
                      <div className="font-medium">
                        {r.quantity} × {product?.name ?? "Deleted product"}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{r.code}</div>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{(r.toLocationId && lookups.location.get(r.toLocationId)?.name) || "—"}</TableCell>
                    <TableCell className="max-w-56 text-sm">
                      {r.requestedBy || "—"} · {timeAgo(r.createdAt)}
                      {r.note && <div className="truncate text-xs text-muted-foreground">“{r.note}”</div>}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Pill tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Pill>
                      {r.fromLocationId && <div className="mt-1 text-xs text-muted-foreground">from {lookups.location.get(r.fromLocationId)?.name}</div>}
                      {r.status === "declined" && r.decisionNote && <div className="mt-1 text-xs text-muted-foreground">“{r.decisionNote}”</div>}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {r.status === "pending" && (
                        <div className="flex justify-end gap-1">
                          {canDecide(r) && (
                            <>
                              <Button size="sm" onClick={() => setApproving(r)}>
                                <Send />
                                Approve
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setDeclining(r)}>
                                Decline
                              </Button>
                            </>
                          )}
                          {(mine || me.role === "owner") && !canDecide(r) && (
                            <ConfirmAction
                              trigger={
                                <Button size="sm" variant="ghost">
                                  Cancel
                                </Button>
                              }
                              title="Cancel this request?"
                              description="Nothing has been sent yet."
                              confirmLabel="Cancel request"
                              onConfirm={() => attempt(() => cancelRequest(r.id), "Request cancelled")}
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
      </CardContent>
      {approving && <ApproveRequestDialog request={approving} onClose={() => setApproving(null)} />}
      {declining && <DeclineRequestDialog request={declining} onClose={() => setDeclining(null)} />}
    </Card>
  )
}

/** Pick where it ships from (a location you run that has it) and how many to send. */
function ApproveRequestDialog({ request: r, onClose }: { request: StockRequest; onClose: () => void }) {
  const scope = useScope()
  const stock = useStore((s) => s.stock)
  const approveRequest = useStore((s) => s.approveRequest)
  const lookups = useLookups()
  const [run, pending] = useAttempt()
  const product = r.productId ? lookups.product.get(r.productId) : undefined
  const sources = scope.locations.filter((l) => l.id !== r.toLocationId && r.productId && qtyAt(stock, r.productId, l.id) > 0)
  const [from, setFrom] = useState((sources.find((l) => l.type === "warehouse") ?? sources[0])?.id ?? "")
  const [quantity, setQuantity] = useState(String(r.quantity))
  const available = r.productId && from ? qtyAt(stock, r.productId, from) : 0
  const qty = Number(quantity)
  const valid = !!from && Number.isInteger(qty) && qty > 0 && qty <= available

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    const ok = await run(() => approveRequest(r.id, { fromLocationId: from, quantity: qty }), `Sent ${qty} × ${product?.name}. The shop receives it when it arrives.`)
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Approve request</DialogTitle>
            <DialogDescription>
              {r.quantity} × {product?.name} for {r.toLocationId && lookups.location.get(r.toLocationId)?.name}
            </DialogDescription>
          </DialogHeader>
          {sources.length === 0 ? (
            <p className="text-sm text-destructive">None of your locations has this product in stock to send.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Send from" hint={from ? `${available} available` : undefined}>
                <SimpleSelect value={from} onChange={setFrom} options={sources.map((l) => ({ value: l.id, label: l.name }))} />
              </Field>
              <Field label="Quantity" htmlFor="appr-qty">
                <Input id="appr-qty" type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
            </div>
          )}
          {qty > available && from && <p className="text-sm text-destructive">Only {available} available there.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              <Send />
              Approve and send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeclineRequestDialog({ request: r, onClose }: { request: StockRequest; onClose: () => void }) {
  const declineRequest = useStore((s) => s.declineRequest)
  const [run, pending] = useAttempt()
  const [note, setNote] = useState("")

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const ok = await run(() => declineRequest(r.id, note.trim()), "Request declined")
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Decline request</DialogTitle>
            <DialogDescription>The shop sees your reason next to the request.</DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="decl-note" hint="Optional.">
            <Input id="decl-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. New delivery arrives Monday" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Back
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              Decline
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
