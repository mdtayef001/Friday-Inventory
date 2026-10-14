"use client"

import { useState } from "react"
import { format } from "date-fns"
import { AlertTriangle, CalendarCheck, CalendarClock, Banknote, LogIn, LogOut, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useAttempt,
  EmptyState,
  Field,
  ListSkeleton,
  PageBody,
  PageHeader,
  Pager,
  QueryError,
  SearchInput,
  SimpleSelect,
  StatCard,
  MoneyTotal,
} from "@/components/common"
import { ClientPicker } from "@/components/client-dialog"
import { ProductPicker } from "@/components/product-picker"
import { usePermissions, useScope } from "@/components/session-provider"
import { CodeInput, ScanButton } from "@/components/scanner"
import { PaymentPicker } from "@/components/payment-picker"
import { PAYMENT_METHODS } from "@/lib/business"
import { RentalStatusPill } from "@/components/status"
import { request } from "@/lib/api/client"
import { actions } from "@/lib/data/actions"
import { PAGE_SIZE, qtyAt, useDebounced, usePageNumber, useRentalSummary, useRentals, withParams } from "@/lib/data/queries"
import { formatDate, formatMoney } from "@/lib/format"
import { countDays, isOverdue, PLAN_LABEL, quoteRental, rentalDueDate, rentalOverdueDays } from "@/lib/rental"
import type { ClientBrief, Page, PaymentMethod, Product, Rental, RentalPlan } from "@/lib/types"

type Filter = "active" | "overdue" | "returned" | "all"

export function RentalsView() {
  const scope = useScope()
  const { canSell } = usePermissions()
  const [filter, setFilter] = useState<Filter>("active")
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const [scanningIn, setScanningIn] = useState(false)
  const [returning, setReturning] = useState<Rental | null>(null)
  const search = useDebounced(query.trim())
  const [page, setPage] = usePageNumber(search, filter)
  const stats = useRentalSummary().data
  const { data, error, isPending, isPlaceholderData, refetch } = useRentals({
    page,
    search,
    status: filter === "active" || filter === "returned" ? filter : undefined,
    overdue: filter === "overdue",
  })
  const rows = data?.results ?? []
  const locationName = (id: string) => scope.locations.find((l) => l.id === id)?.name

  return (
    <PageBody>
      <PageHeader
        title="Rentals"
        description="Who has what, for how long, and how much they owe."
        actions={
          canSell && (
            <>
              <Button variant="outline" onClick={() => setScanningIn(true)}>
                <LogIn />
                Scan in
              </Button>
              <Button onClick={() => setCreating(true)} disabled={scope.locations.length === 0}>
                <LogOut />
                Scan out
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Out on rent" value={stats?.active ?? "–"} icon={CalendarClock} />
        <StatCard
          label="Overdue"
          value={stats?.overdue ?? "–"}
          hint={stats?.overdue ? "Follow up with these clients" : "All on time"}
          icon={AlertTriangle}
          tone={stats?.overdue ? "red" : "green"}
        />
        <StatCard label="Running total (out now)" value={stats ? <MoneyTotal value={stats.running} /> : "–"} icon={Banknote} tone="violet" />
        <StatCard label="Earned (returned)" value={stats ? <MoneyTotal value={stats.earned} /> : "–"} icon={CalendarCheck} tone="green" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="overdue">Overdue{stats?.overdue ? ` (${stats.overdue})` : ""}</TabsTrigger>
            <TabsTrigger value="returned">Returned</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <SearchInput value={query} onChange={setQuery} placeholder="Search rental, client, product…" className="sm:w-72" />
      </div>

      {error && !data ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No rentals here" description="Rent out a product to see it in this list." />
      ) : (
        <Card className={isPlaceholderData ? "py-0 opacity-60 transition-opacity" : "py-0"}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Rental</TableHead>
                  <TableHead>Rented to</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const client = r.client
                  const overdue = isOverdue(r)
                  const diff = rentalOverdueDays(r)
                  const due = rentalDueDate(r)
                  const out = countDays(r.startDate, r.returnedAt ? new Date(r.returnedAt) : undefined)
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="pl-4">
                        <div className="font-medium">
                          {r.quantity > 1 && `${r.quantity} × `}
                          {r.productName ?? "Deleted product"}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {r.code} · {locationName(r.locationId)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{client?.name ?? "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">{client?.phone ?? client?.company}</div>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {formatDate(r.startDate)}
                        {due && ` → ${format(due, "MMM d")}`}
                        <div className={overdue ? "text-xs font-medium text-red-600 dark:text-red-400" : "text-xs text-muted-foreground"}>
                          {r.status === "returned"
                            ? `Back ${r.returnedAt ? formatDate(r.returnedAt) : ""} · ${r.daysOut ?? out} day${(r.daysOut ?? out) === 1 ? "" : "s"}${r.holidays ? ` − ${r.holidays} holiday${r.holidays === 1 ? "" : "s"}` : ""}`
                            : overdue
                              ? `${diff} day${diff === 1 ? "" : "s"} overdue`
                              : diff === null
                                ? `Out ${out} day${out === 1 ? "" : "s"}`
                                : diff === 0
                                  ? "Due today"
                                  : `${-diff} day${diff === -1 ? "" : "s"} left`}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {PLAN_LABEL[r.plan]}
                        <div className="text-xs text-muted-foreground">
                          {r.plan === "fixed"
                            ? formatMoney(r.rate)
                            : `${formatMoney(r.rate)} × ${quoteRental(r.plan, r.rate, r.daysOut ?? out, 1, r.holidays).periodLabel}`}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(r.status === "returned" ? r.total : quoteRental(r.plan, r.rate, out, r.quantity).total)}
                        {r.status === "active" && <div className="text-xs font-normal text-muted-foreground">so far</div>}
                        {r.deposit > 0 && <div className="text-xs font-normal text-muted-foreground">+{formatMoney(r.deposit)} deposit</div>}
                      </TableCell>
                      <TableCell>
                        <RentalStatusPill status={r.status} overdue={overdue} />
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        {r.status === "active" && canSell && (
                          <Button size="sm" variant="outline" onClick={() => setReturning(r)}>
                            <Undo2 />
                            Return
                          </Button>
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
      {data && <Pager page={data.page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} busy={isPlaceholderData} />}

      {creating && <NewRentalDialog onClose={() => setCreating(false)} />}
      {scanningIn && (
        <ScanInDialog
          onClose={() => setScanningIn(false)}
          onFound={(r) => {
            setScanningIn(false)
            setReturning(r)
          }}
        />
      )}
      {returning && <ReturnRentalDialog rental={returning} onClose={() => setReturning(null)} />}
    </PageBody>
  )
}

function NewRentalDialog({ onClose }: { onClose: () => void }) {
  const scope = useScope()
  const [locationId, setLocationId] = useState(scope.locations[0]?.id ?? "")
  const [client, setClient] = useState<ClientBrief | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState("1")
  const [days, setDays] = useState("")
  const [plan, setPlan] = useState<RentalPlan>("daily")
  const [rate, setRate] = useState("")
  const [deposit, setDeposit] = useState("0")
  const [notes, setNotes] = useState("")

  const clientId = client?.id ?? ""
  const available = qtyAt(product, locationId)
  const plans: RentalPlan[] = [...(["daily", "weekly", "monthly"] as const).filter((p) => product?.rentRates?.[p]), "fixed"]

  function choosePlan(next: RentalPlan, p = product) {
    setPlan(next)
    setRate(next === "fixed" ? "" : String(p?.rentRates?.[next] ?? ""))
  }

  function chooseProduct(p: Product) {
    setProduct(p)
    const first = (["daily", "weekly", "monthly"] as const).find((k) => p.rentRates?.[k]) ?? "fixed"
    choosePlan(first, p)
  }

  const qty = Number(quantity)
  const dayCount = days === "" ? null : Number(days)
  const rateNum = Number(rate)
  const quote = quoteRental(plan, rateNum, dayCount ?? 1, qty)
  const daysOk = dayCount === null || (Number.isInteger(dayCount) && dayCount > 0)
  const valid = clientId && product && Number.isInteger(qty) && qty > 0 && qty <= available && daysOk && rate !== "" && rateNum >= 0 && Number(deposit) >= 0

  /** Scanning picks the product (and moves to a shop that has it free). */
  async function scanProduct(code: string) {
    let p: Product | undefined
    try {
      p = (await request<Page<Product>>(withParams("products/", { code, page: 1, pageSize: 1 }))).results[0]
    } catch (err) {
      return toast.error(err instanceof Error ? err.message : "Couldn't look that up.")
    }
    if (!p) return toast.error(`No product uses ${code}.`)
    if (!p.rentable) return toast.error(`${p.name} isn't set up for rent.`)
    const found = p
    const here = qtyAt(found, locationId) > 0 ? locationId : scope.locations.find((l) => qtyAt(found, l.id) > 0)?.id
    if (!here) return toast.error(`No ${p.name} free at your shops.`)
    setLocationId(here)
    chooseProduct(p)
  }

  const [run, pending] = useAttempt()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || !product) return
    const ok = await run(
      () =>
        actions.createRental(
          {
            productId: product.id,
            quantity: qty,
            clientId,
            locationId,
            // Out from now; the price is settled from the real days when it comes back.
            startDate: new Date().toISOString(),
            days: dayCount,
            plan,
            rate: rateNum,
            deposit: Number(deposit) || 0,
            notes: notes.trim() || undefined,
          },
        ),
      "Rented out. The clock is running.",
    )
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Scan out</DialogTitle>
            <DialogDescription>It goes out now. The price is worked out from the real days when it&apos;s scanned back in.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rented to" className="sm:col-span-2">
              <ClientPicker value={client} onChange={setClient} />
            </Field>
            <Field label="From location">
              <SimpleSelect
                value={locationId}
                onChange={(v) => {
                  setLocationId(v)
                  setProduct(null)
                }}
                options={scope.locations.map((l) => ({ value: l.id, label: l.name }))}
              />
            </Field>
            <Field label="Product" hint="Rentable products free at this location.">
              <div className="flex min-w-0 gap-2">
                <ProductPicker
                  value={product}
                  onChange={chooseProduct}
                  params={{ location: locationId, inStock: true, rentable: true }}
                  describe={(p) => `${qtyAt(p, locationId)} free`}
                  placeholder="Choose or scan"
                  disabled={!locationId}
                />
                <ScanButton onScan={scanProduct} />
              </div>
            </Field>
            <Field label="Quantity" htmlFor="rn-qty" hint={product ? `${available} available` : undefined}>
              <Input id="rn-qty" type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
            <Field label="Expected days" htmlFor="rn-days" hint="Optional. Only for the due date and overdue reminder.">
              <Input id="rn-days" type="number" min="1" step="1" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Open" />
            </Field>
          </div>

          <div className="space-y-3 rounded-xl border p-4">
            <p className="text-sm font-medium">Pricing</p>
            <div className="flex flex-wrap gap-2">
              {plans.map((p) => (
                <Button key={p} type="button" size="sm" variant={plan === p ? "default" : "outline"} onClick={() => choosePlan(p)}>
                  {PLAN_LABEL[p]}
                  {p !== "fixed" && product?.rentRates?.[p] ? ` · ${formatMoney(product.rentRates[p]!)}` : ""}
                </Button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={plan === "fixed" ? "Fixed price (per unit)" : `${PLAN_LABEL[plan]} rate`} htmlFor="rn-rate">
                <Input id="rn-rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Deposit" htmlFor="rn-deposit" hint="Refundable, not included in the total.">
                <Input id="rn-deposit" type="number" min="0" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
              </Field>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl bg-primary/5 p-4 ring-1 ring-primary/20">
            <div className="text-sm">
              <p className="font-medium">{dayCount ? "Estimate" : "Price"}</p>
              <p className="text-muted-foreground">
                {plan === "fixed"
                  ? "Fixed price"
                  : dayCount
                    ? `${formatMoney(rateNum || 0)} × ${quote.periodLabel}${qty > 1 ? ` × ${qty} units` : ""} · due back ${format(rentalDueDate({ startDate: new Date().toISOString(), days: dayCount })!, "MMM d")}`
                    : `${formatMoney(rateNum || 0)} ${PLAN_LABEL[plan].toLowerCase()}${qty > 1 ? ` × ${qty} units` : ""}, charged for the real time out`}
              </p>
            </div>
            <p className="text-2xl font-semibold tabular-nums">{plan === "fixed" || dayCount ? formatMoney(quote.total) : "—"}</p>
          </div>

          <Field label="Notes" htmlFor="rn-notes">
            <Textarea id="rn-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ID checked, condition, delivery…" rows={2} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              <LogOut />
              Scan out
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Scan or type the item (or the rental code) to find what's coming back. */
function ScanInDialog({ onClose, onFound }: { onClose: () => void; onFound: (r: Rental) => void }) {
  const [matches, setMatches] = useState<Rental[] | null>(null)

  /** The rental code, or the item's barcode or SKU, among the rentals out now. */
  async function find(code: string) {
    let found: Rental[]
    try {
      found = (await request<Page<Rental>>(withParams("rentals/", { code: code.trim(), status: "active", page: 1, pageSize: 50 }))).results
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't look that up.")
      return
    }
    const exact = found.find((r) => r.code.toLowerCase() === code.trim().toLowerCase())
    if (exact) return onFound(exact)
    if (found.length === 1) return onFound(found[0])
    if (found.length === 0) {
      toast.error(`Nothing out on rent matches ${code}.`)
      return
    }
    setMatches(found)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan in</DialogTitle>
          <DialogDescription>Scan the item coming back, or type its code or the rental code (RNT-…).</DialogDescription>
        </DialogHeader>
        {matches ? (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">More than one is out. Which one is this?</p>
            {matches.map((r) => (
              <Button key={r.id} variant="outline" className="h-auto justify-between py-2" onClick={() => onFound(r)}>
                <span className="text-left">
                  <span className="block font-medium">{r.client?.name ?? "Unknown client"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.code} · out since {formatDate(r.startDate)}
                  </span>
                </span>
                <span className="text-xs">{r.quantity}×</span>
              </Button>
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            <CodeInput onSubmit={find} autoFocus placeholder="Scan or type the item or rental code" />
            <ScanButton onScan={find} label="Use the camera" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Scan in: counts the days out, takes off holidays (per-day plan), shows what to collect, puts it back in stock. */
function ReturnRentalDialog({ rental: r, onClose }: { rental: Rental; onClose: () => void }) {
  const { returnRental } = actions
  const [run, pending] = useAttempt()
  const [holidays, setHolidays] = useState("")
  const [method, setMethod] = useState<PaymentMethod>("cash")
  const daysOut = countDays(r.startDate)
  const off = r.plan === "daily" ? Number(holidays) || 0 : 0
  const holidaysOk = Number.isInteger(off) && off >= 0 && off < daysOut
  const quote = quoteRental(r.plan, r.rate, daysOut, r.quantity, off)
  const due = quote.total - r.deposit

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!holidaysOk) return
    const ok = await run(
      () => returnRental(r.id, off, method),
      `Returned. ${due >= 0 ? `Collect ${formatMoney(due)} (${PAYMENT_METHODS[method].short})` : `Give back ${formatMoney(-due)}`}.`,
    )
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Scan in · {r.code}</DialogTitle>
            <DialogDescription>
              {r.quantity} × {r.productName ?? "Deleted product"} from {r.client?.name ?? "unknown client"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 rounded-xl border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Out since</span>
              <span>{formatDate(r.startDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Days out</span>
              <span className="font-medium tabular-nums">{daysOut}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <span>
                {PLAN_LABEL[r.plan]} · {formatMoney(r.rate)}
              </span>
            </div>
          </div>
          {r.plan === "daily" && (
            <Field label="Holidays" htmlFor="rn-holidays" hint="Days not charged, such as public holidays. Per-day plan only.">
              <Input id="rn-holidays" type="number" min="0" max={daysOut - 1} step="1" placeholder="0" value={holidays} onChange={(e) => setHolidays(e.target.value)} />
            </Field>
          )}
          {!holidaysOk && <p className="text-sm text-destructive">Holidays must be fewer than the {daysOut} days it was out.</p>}
          <div className="grid gap-1.5 rounded-xl bg-primary/5 p-4 text-sm ring-1 ring-primary/20">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {r.plan === "fixed"
                  ? "Fixed price"
                  : r.plan === "daily"
                    ? `${daysOut}${off ? ` − ${off}` : ""} days × ${formatMoney(r.rate)}`
                    : `${quote.periodLabel} × ${formatMoney(r.rate)}`}
                {r.quantity > 1 ? ` × ${r.quantity}` : ""}
              </span>
              <span className="font-medium tabular-nums">{formatMoney(quote.total)}</span>
            </div>
            {r.deposit > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deposit paid</span>
                <span className="tabular-nums">−{formatMoney(r.deposit)}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t pt-2 text-base font-semibold">
              <span>{due >= 0 ? "To collect" : "Give back"}</span>
              <span className="tabular-nums">{formatMoney(Math.abs(due))}</span>
            </div>
          </div>
          {due > 0 && <PaymentPicker value={method} onChange={setMethod} allowOnline={false} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!holidaysOk || pending}>
              <LogIn />
              Scan in
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
