"use client"

import { useMemo, useState } from "react"
import { format } from "date-fns"
import { AlertTriangle, CalendarCheck, CalendarClock, DollarSign, Plus, Search, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { attempt, useAttempt, ConfirmAction, EmptyState, Field, PageBody, PageHeader, SimpleSelect, StatCard } from "@/components/common"
import { ClientPicker } from "@/components/client-dialog"
import { useScope } from "@/components/session-provider"
import { RentalStatusPill } from "@/components/status"
import { formatDate, formatMoney } from "@/lib/format"
import { isOverdue, PLAN_LABEL, quoteRental, rentalDueDate, rentalOverdueDays } from "@/lib/rental"
import { qtyAt, useStore } from "@/lib/store"
import { useLookups } from "@/lib/store/hooks"
import type { RentalPlan } from "@/lib/types"

type Filter = "active" | "overdue" | "returned" | "all"

export function RentalsView() {
  const scope = useScope()
  const rentals = useStore((s) => s.rentals)
  const returnRental = useStore((s) => s.returnRental)
  const lookups = useLookups()
  const [filter, setFilter] = useState<Filter>("active")
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)

  const mine = useMemo(() => rentals.filter((r) => scope.has(r.locationId)), [rentals, scope])
  const stats = useMemo(() => {
    const active = mine.filter((r) => r.status === "active")
    return {
      active: active.length,
      overdue: active.filter((r) => isOverdue(r)).length,
      expected: active.reduce((s, r) => s + r.total, 0),
      earned: mine.filter((r) => r.status === "returned").reduce((s, r) => s + r.total, 0),
    }
  }, [mine])

  const q = query.trim().toLowerCase()
  const rows = mine.filter((r) => {
    if (filter === "active" && r.status !== "active") return false
    if (filter === "overdue" && !isOverdue(r)) return false
    if (filter === "returned" && r.status !== "returned") return false
    if (!q) return true
    return [r.code, lookups.product.get(r.productId)?.name, lookups.client.get(r.clientId)?.name].some((v) => v?.toLowerCase().includes(q))
  })

  return (
    <PageBody>
      <PageHeader
        title="Rentals"
        description="Who has what, for how long, and how much they owe."
        actions={
          <Button onClick={() => setCreating(true)} disabled={scope.locations.length === 0}>
            <Plus />
            New rental
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Out on rent" value={stats.active} icon={CalendarClock} />
        <StatCard label="Overdue" value={stats.overdue} hint={stats.overdue ? "Follow up with these clients" : "All on time"} icon={AlertTriangle} tone={stats.overdue ? "red" : "green"} />
        <StatCard label="Expected from active" value={formatMoney(stats.expected)} icon={DollarSign} tone="violet" />
        <StatCard label="Earned (returned)" value={formatMoney(stats.earned)} icon={CalendarCheck} tone="green" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="overdue">Overdue{stats.overdue ? ` (${stats.overdue})` : ""}</TabsTrigger>
            <TabsTrigger value="returned">Returned</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rental, client, product…" className="h-9 pl-9" />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No rentals here" description="Rent out a product to see it in this list." />
      ) : (
        <Card className="py-0">
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
                  const product = lookups.product.get(r.productId)
                  const client = lookups.client.get(r.clientId)
                  const overdue = isOverdue(r)
                  const diff = rentalOverdueDays(r)
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="pl-4">
                        <div className="font-medium">
                          {r.quantity > 1 && `${r.quantity} × `}
                          {product?.name ?? "Deleted product"}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {r.code} · {lookups.location.get(r.locationId)?.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{client?.name ?? "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">{client?.phone ?? client?.company}</div>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {formatDate(r.startDate)} → {format(rentalDueDate(r), "MMM d")}
                        <div className={overdue ? "text-xs font-medium text-red-600 dark:text-red-400" : "text-xs text-muted-foreground"}>
                          {r.status === "returned"
                            ? `Returned ${r.returnedAt ? formatDate(r.returnedAt) : ""}`
                            : overdue
                              ? `${diff} day${diff === 1 ? "" : "s"} overdue`
                              : diff === 0
                                ? "Due today"
                                : `${-diff} day${diff === -1 ? "" : "s"} left`}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {PLAN_LABEL[r.plan]}
                        <div className="text-xs text-muted-foreground">
                          {r.plan === "fixed" ? formatMoney(r.rate) : `${formatMoney(r.rate)} × ${quoteRental(r.plan, r.rate, r.days, 1).periodLabel}`}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(r.total)}
                        {r.deposit > 0 && <div className="text-xs font-normal text-muted-foreground">+{formatMoney(r.deposit)} deposit</div>}
                      </TableCell>
                      <TableCell>
                        <RentalStatusPill status={r.status} overdue={overdue} />
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        {r.status === "active" && (
                          <ConfirmAction
                            trigger={
                              <Button size="sm" variant="outline">
                                <Undo2 />
                                Return
                              </Button>
                            }
                            title="Mark rental as returned?"
                            description={`${r.quantity} × ${product?.name} goes back into stock at ${lookups.location.get(r.locationId)?.name}. Amount due: ${formatMoney(r.total)}.`}
                            confirmLabel="Mark returned"
                            onConfirm={() => attempt(() => returnRental(r.id), "Rental returned")}
                          />
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

      {creating && <NewRentalDialog onClose={() => setCreating(false)} />}
    </PageBody>
  )
}

function NewRentalDialog({ onClose }: { onClose: () => void }) {
  const scope = useScope()
  const products = useStore((s) => s.products)
  const stock = useStore((s) => s.stock)
  const createRental = useStore((s) => s.createRental)
  const [locationId, setLocationId] = useState(scope.locations[0]?.id ?? "")
  const [clientId, setClientId] = useState("")
  const [productId, setProductId] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [days, setDays] = useState("1")
  const [plan, setPlan] = useState<RentalPlan>("daily")
  const [rate, setRate] = useState("")
  const [deposit, setDeposit] = useState("0")
  const [notes, setNotes] = useState("")

  const rentable = products.filter((p) => p.rentable && qtyAt(stock, p.id, locationId) > 0)
  const product = products.find((p) => p.id === productId)
  const available = product ? qtyAt(stock, product.id, locationId) : 0
  const plans: RentalPlan[] = [...(["daily", "weekly", "monthly"] as const).filter((p) => product?.rentRates?.[p]), "fixed"]

  function choosePlan(next: RentalPlan, p = product) {
    setPlan(next)
    setRate(next === "fixed" ? "" : String(p?.rentRates?.[next] ?? ""))
  }

  function chooseProduct(id: string) {
    setProductId(id)
    const p = products.find((x) => x.id === id)
    const first = (["daily", "weekly", "monthly"] as const).find((k) => p?.rentRates?.[k]) ?? "fixed"
    choosePlan(first, p)
  }

  const qty = Number(quantity)
  const dayCount = Number(days)
  const rateNum = Number(rate)
  const quote = quoteRental(plan, rateNum, dayCount, qty)
  const valid =
    clientId && product && Number.isInteger(qty) && qty > 0 && qty <= available && Number.isInteger(dayCount) && dayCount > 0 && rate !== "" && rateNum >= 0 && Number(deposit) >= 0

  const [run, pending] = useAttempt()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || !product) return
    const ok = await run(
      () =>
        createRental(
          {
            productId: product.id,
            quantity: qty,
            clientId,
            locationId,
            startDate: new Date(startDate + "T09:00:00").toISOString(),
            days: dayCount,
            plan,
            rate: rateNum,
            deposit: Number(deposit) || 0,
            notes: notes.trim() || undefined,
          },
        ),
      "Rental created",
    )
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>New rental</DialogTitle>
            <DialogDescription>The price is worked out for you as you fill this in.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rented to" className="sm:col-span-2">
              <ClientPicker value={clientId} onChange={setClientId} />
            </Field>
            <Field label="From location">
              <SimpleSelect
                value={locationId}
                onChange={(v) => {
                  setLocationId(v)
                  setProductId("")
                }}
                options={scope.locations.map((l) => ({ value: l.id, label: l.name }))}
              />
            </Field>
            <Field label="Product" hint={rentable.length === 0 ? "No rentable products in stock here." : undefined}>
              <SimpleSelect
                value={productId}
                onChange={chooseProduct}
                options={rentable.map((p) => ({ value: p.id, label: `${p.name} (${qtyAt(stock, p.id, locationId)} free)` }))}
                placeholder="Choose product"
              />
            </Field>
            <Field label="Quantity" htmlFor="rn-qty" hint={product ? `${available} available` : undefined}>
              <Input id="rn-qty" type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start date" htmlFor="rn-start">
                <Input id="rn-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label="Number of days" htmlFor="rn-days">
                <Input id="rn-days" type="number" min="1" step="1" value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
            </div>
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
              <p className="font-medium">Total to charge</p>
              <p className="text-muted-foreground">
                {plan === "fixed" ? `Fixed price for ${quote.periodLabel}` : `${formatMoney(rateNum || 0)} × ${quote.periodLabel}`}
                {qty > 1 ? ` × ${qty} units` : ""}
                {dayCount > 0 && ` · due back ${format(rentalDueDate({ startDate: startDate + "T09:00:00", days: dayCount }), "MMM d, yyyy")}`}
              </p>
            </div>
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(quote.total)}</p>
          </div>

          <Field label="Notes" htmlFor="rn-notes">
            <Textarea id="rn-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ID checked, condition, delivery…" rows={2} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              Create rental
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
