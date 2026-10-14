"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowLeftRight, ArrowRight, Check, Inbox, PackagePlus, Plus, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  attempt,
  useAttempt,
  ConfirmAction,
  EmptyState,
  Field,
  ListSkeleton,
  PageBody,
  PageHeader,
  Pager,
  Pill,
  QueryError,
  SearchInput,
  SimpleSelect,
  type PillTone,
} from "@/components/common"
import { ProductPicker } from "@/components/product-picker"
import { useScope, useSessionUser } from "@/components/session-provider"
import { RequestStockDialog } from "@/components/stock-request-dialog"
import { TransferStatusPill } from "@/components/status"
import { actions } from "@/lib/data/actions"
import { qtyAt, useDebounced, useLocations, usePaging, useProduct, useStockRequests, useTransfers } from "@/lib/data/queries"
import { formatDateTime, timeAgo } from "@/lib/format"
import type { Product, StockRequest, StockRequestStatus, TransferStatus } from "@/lib/types"

type Tab = "transfers" | "requests"

export function TransfersView() {
  const scope = useScope()
  // ?tab=requests opens the stock requests, e.g. from a link.
  const [tab, setTab] = useState<Tab>(useSearchParams().get("tab") === "requests" ? "requests" : "transfers")
  const [creating, setCreating] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const waiting = useStockRequests({ page: 1, status: "pending" }, { pageSize: 1 }).data?.count ?? 0

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

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="transfers">
            <ArrowLeftRight />
            Transfers
          </TabsTrigger>
          <TabsTrigger value="requests">
            <Inbox />
            Stock requests
            {waiting > 0 && <Pill tone="amber">{waiting} waiting</Pill>}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "transfers" ? <TransferList /> : <StockRequests />}

      {requesting && <RequestStockDialog onClose={() => setRequesting(false)} />}
      {creating && <NewTransferDialog onClose={() => setCreating(false)} />}
    </PageBody>
  )
}

const TRANSFER_FILTERS: { value: "all" | TransferStatus; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "in_transit", label: "In transit" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
]

/** Every transfer to or from the user's locations, newest first. */
function TransferList() {
  const scope = useScope()
  const locations = useLocations()
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<(typeof TRANSFER_FILTERS)[number]["value"]>("all")
  const [location, setLocation] = useState("all")
  const search = useDebounced(query.trim())
  const paging = usePaging(search, status, location)
  const { data, error, isPending, isPlaceholderData, refetch } = useTransfers(
    {
      page: paging.page,
      search,
      status: status === "all" ? undefined : status,
      location: location === "all" ? undefined : location,
    },
    { pageSize: paging.pageSize },
  )
  const rows = data?.results ?? []
  const filtered = !!search || status !== "all" || location !== "all"

  return (
    <>
      <div className="flex flex-col gap-2 md:flex-row">
        <SearchInput value={query} onChange={setQuery} placeholder="Search reference or product…" className="flex-1" />
        <SimpleSelect value={status} onChange={(v) => setStatus(v as typeof status)} options={TRANSFER_FILTERS} className="h-9! md:w-44" />
        <SimpleSelect
          value={location}
          onChange={setLocation}
          options={[{ value: "all", label: "Any location" }, ...scope.locations.map((l) => ({ value: l.id, label: `To or from ${l.name}` }))]}
          className="h-9! md:w-56"
        />
      </div>

      {error && !data ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={filtered ? "No transfers match your filters" : "No transfers yet"}
          description={filtered ? "Try a different search or clear the filters." : "Send stock from one location to another to see it here."}
        />
      ) : (
        <Card className={isPlaceholderData ? "py-0 opacity-60 transition-opacity" : "py-0"}>
          <div className="overflow-x-auto">
            <Table scroll>
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
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="pl-4 font-mono text-xs">{t.code}</TableCell>
                      <TableCell>
                        <div className="font-medium">{t.productName ?? "Deleted product"}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.quantity} {t.productUnit}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm whitespace-nowrap">
                          {locationName(t.fromLocationId) ?? "—"}
                          <ArrowRight className="size-3.5 text-muted-foreground" />
                          {locationName(t.toLocationId) ?? "—"}
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
                              <Button size="sm" onClick={() => attempt(() => actions.receiveTransfer(t.id), "Transfer received")}>
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
                                onConfirm={() => attempt(() => actions.cancelTransfer(t.id), "Transfer cancelled")}
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
      {data && <Pager page={data.page} pageSize={paging.pageSize} count={data.count} onPage={paging.setPage} onPageSize={paging.setPageSize} busy={isPlaceholderData} />}
    </>
  )
}

function NewTransferDialog({ onClose }: { onClose: () => void }) {
  const scope = useScope()
  const allLocations = useLocations()
  const [from, setFrom] = useState(scope.locations[0]?.id ?? "")
  const [to, setTo] = useState("")
  const [product, setProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState("1")

  const productId = product?.id ?? ""
  const available = qtyAt(product, from)
  const qty = Number(quantity)
  const valid = from && to && from !== to && productId && Number.isInteger(qty) && qty > 0 && qty <= available

  const [run, pending] = useAttempt()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    const ok = await run(() => actions.createTransfer({ productId, quantity: qty, fromLocationId: from, toLocationId: to }), "Transfer sent")
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
                  setProduct(null)
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
          <Field label="Product" hint="Only products with stock at this location.">
            <ProductPicker
              value={product}
              onChange={setProduct}
              params={{ location: from, inStock: true }}
              describe={(p) => `${qtyAt(p, from)} ${p.unit}`}
              disabled={!from}
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

const REQUEST_FILTERS: { value: "all" | StockRequestStatus; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Sent" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
]

/** Requests from shops, waiting ones first. */
function StockRequests() {
  const me = useSessionUser()
  const locations = useLocations()
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name
  const canDecide = useCanDecide()
  const [approving, setApproving] = useState<StockRequest | null>(null)
  const [declining, setDeclining] = useState<StockRequest | null>(null)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<(typeof REQUEST_FILTERS)[number]["value"]>("all")
  const [location, setLocation] = useState("all")
  const search = useDebounced(query.trim())
  const paging = usePaging(search, status, location)
  const { data, error, isPending, isPlaceholderData, refetch } = useStockRequests(
    {
      page: paging.page,
      search,
      status: status === "all" ? undefined : status,
      location: location === "all" ? undefined : location,
    },
    { pageSize: paging.pageSize },
  )
  const rows = data?.results ?? []
  const filtered = !!search || status !== "all" || location !== "all"

  const filters = (
    <div className="flex flex-col gap-2 md:flex-row">
      <SearchInput value={query} onChange={setQuery} placeholder="Search reference, product or note…" className="flex-1" />
      <SimpleSelect value={status} onChange={(v) => setStatus(v as typeof status)} options={REQUEST_FILTERS} className="h-9! md:w-44" />
      <SimpleSelect
        value={location}
        onChange={setLocation}
        options={[{ value: "all", label: "Any shop" }, ...locations.map((l) => ({ value: l.id, label: `For ${l.name}` }))]}
        className="h-9! md:w-56"
      />
    </div>
  )

  if (error && !data) {
    return (
      <>
        {filters}
        <QueryError error={error} onRetry={() => refetch()} />
      </>
    )
  }
  if (isPending) {
    return (
      <>
        {filters}
        <ListSkeleton />
      </>
    )
  }
  if (rows.length === 0) {
    return (
      <>
        {filters}
        <EmptyState
          icon={Inbox}
          title={filtered ? "No requests match your filters" : "No stock requests yet"}
          description={filtered ? "Try a different search or clear the filters." : "Shops ask for stock with Request stock. Their requests show up here."}
        />
      </>
    )
  }

  return (
    <>
      {filters}
      <Card className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
        <CardHeader>
          <CardDescription>Shops asking for stock. Approving one sends a transfer from the location you pick.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table scroll>
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
                  const mine = r.requestedById === me.id
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="pl-4">
                        <div className="font-medium">
                          {r.quantity} × {r.productName ?? "Deleted product"}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">{r.code}</div>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{(r.toLocationId && locationName(r.toLocationId)) || "—"}</TableCell>
                      <TableCell className="max-w-56 text-sm">
                        {r.requestedBy || "—"} · {timeAgo(r.createdAt)}
                        {r.note && <div className="truncate text-xs text-muted-foreground">“{r.note}”</div>}
                      </TableCell>
                      <TableCell className="text-sm">
                        <Pill tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Pill>
                        {r.fromLocationId && <div className="mt-1 text-xs text-muted-foreground">from {locationName(r.fromLocationId)}</div>}
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
                                onConfirm={() => attempt(() => actions.cancelRequest(r.id), "Request cancelled")}
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
      {data && <Pager page={data.page} pageSize={paging.pageSize} count={data.count} onPage={paging.setPage} onPageSize={paging.setPageSize} busy={isPlaceholderData} />}
    </>
  )
}

/** Pick where it ships from (a location you run that has it) and how many to send. */
function ApproveRequestDialog({ request: r, onClose }: { request: StockRequest; onClose: () => void }) {
  const scope = useScope()
  const locations = useLocations()
  const [run, pending] = useAttempt()
  // Loaded fresh, for its stock at each of your locations right now.
  const { data: product, isPending: loading } = useProduct(r.productId)
  const sources = scope.locations.filter((l) => l.id !== r.toLocationId && qtyAt(product, l.id) > 0)
  const [picked, setFrom] = useState("")
  const from = picked || ((sources.find((l) => l.type === "warehouse") ?? sources[0])?.id ?? "")
  const [quantity, setQuantity] = useState(String(r.quantity))
  const available = qtyAt(product, from)
  const qty = Number(quantity)
  const valid = !!from && Number.isInteger(qty) && qty > 0 && qty <= available

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    const ok = await run(() => actions.approveRequest(r.id, { fromLocationId: from, quantity: qty }), `Sent ${qty} × ${r.productName}. The shop receives it when it arrives.`)
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Approve request</DialogTitle>
            <DialogDescription>
              {r.quantity} × {r.productName} for {r.toLocationId && locations.find((l) => l.id === r.toLocationId)?.name}
            </DialogDescription>
          </DialogHeader>
          {loading && r.productId ? (
            <ListSkeleton rows={1} />
          ) : sources.length === 0 ? (
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
  const { declineRequest } = actions
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
