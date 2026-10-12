"use client"

import { useEffect, useMemo, useState } from "react"
import { endOfDay, startOfDay, startOfMonth, subDays, subMonths } from "date-fns"
import { CalendarClock, DollarSign, Package, Percent, Receipt, ShoppingCart, Store, TrendingUp, Truck } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, PageBody, PageHeader, Pill, SimpleSelect, StatCard, type PillTone } from "@/components/common"
import { useScope, useSessionUser } from "@/components/session-provider"
import { request } from "@/lib/api/client"
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format"
import { useStore } from "@/lib/store"
import { useLookups } from "@/lib/store/hooks"
import type { Sale, SaleChannel } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Totals {
  count: number
  revenue: number
  cost?: number
  profit?: number
}

interface Summary extends Totals {
  unitsSold: number
  refundedCount: number
  margin?: number | null
  channels: Record<SaleChannel, Totals>
  sellers: { id: string; name: string }[]
}

const CHANNELS: Record<SaleChannel, { label: string; tone: PillTone; icon: typeof Store }> = {
  store: { label: "In store", tone: "blue", icon: Store },
  order: { label: "Order", tone: "violet", icon: Truck },
  rental: { label: "Rental", tone: "amber", icon: CalendarClock },
}

type Period = "today" | "7d" | "30d" | "month" | "lastMonth" | "all" | "custom"
const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom dates" },
]

/** The period as a [from, to) range in the browser's time zone. */
function range(period: Period, customFrom: string, customTo: string): { from?: Date; to?: Date } {
  const now = new Date()
  switch (period) {
    case "today":
      return { from: startOfDay(now) }
    case "7d":
      return { from: startOfDay(subDays(now, 6)) }
    case "30d":
      return { from: startOfDay(subDays(now, 29)) }
    case "month":
      return { from: startOfMonth(now) }
    case "lastMonth":
      return { from: startOfMonth(subMonths(now, 1)), to: startOfMonth(now) }
    case "custom":
      return {
        from: customFrom ? startOfDay(new Date(customFrom + "T00:00")) : undefined,
        to: customTo ? endOfDay(new Date(customTo + "T00:00")) : undefined,
      }
    default:
      return {}
  }
}

export function SalesView() {
  const user = useSessionUser()
  const scope = useScope()
  const products = useStore((s) => s.products)
  const lookups = useLookups()
  const isOwner = user.role === "owner"

  const [period, setPeriod] = useState<Period>("30d")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [location, setLocation] = useState("all")
  const [product, setProduct] = useState("all")
  const [seller, setSeller] = useState("all")
  const [channel, setChannel] = useState<"all" | SaleChannel>("all")
  const [data, setData] = useState<{ key: string; summary: Summary; sales: Sale[] } | null>(null)
  const [error, setError] = useState("")

  const query = useMemo(() => {
    const { from, to } = range(period, customFrom, customTo)
    const q = new URLSearchParams()
    if (from) q.set("from", from.toISOString())
    if (to) q.set("to", to.toISOString())
    if (location !== "all") q.set("location", location)
    if (product !== "all") q.set("product", product)
    if (seller !== "all") q.set("seller", seller)
    if (channel !== "all") q.set("channel", channel)
    return q.toString()
  }, [period, customFrom, customTo, location, product, seller, channel])

  useEffect(() => {
    let cancelled = false
    Promise.all([request<Summary>(`sales/summary/?${query}`), request<Sale[]>(`sales/?${query}`)]).then(
      ([summary, sales]) => {
        if (cancelled) return
        setData({ key: query, summary, sales })
        setError("")
      },
      (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Couldn't load sales."),
    )
    return () => {
      cancelled = true
    }
  }, [query])

  const loading = data?.key !== query
  const summary = data?.summary
  const sales = data?.sales ?? []

  return (
    <PageBody>
      <PageHeader title="Sales" description={isOwner ? "What you sold, what it earned and what you kept." : "What your shops sold."} />

      <div className="flex flex-wrap gap-2">
        <SimpleSelect className="w-40" value={period} onChange={(v) => setPeriod(v as Period)} options={PERIODS} />
        {period === "custom" && (
          <>
            <Input type="date" className="w-40" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From" />
            <Input type="date" className="w-40" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="To" />
          </>
        )}
        <SimpleSelect
          className="w-44"
          value={location}
          onChange={setLocation}
          options={[{ value: "all", label: scope.isOwner ? "All locations" : "All my shops" }, ...scope.locations.map((l) => ({ value: l.id, label: l.name }))]}
        />
        <SimpleSelect
          className="w-52"
          value={product}
          onChange={setProduct}
          options={[{ value: "all", label: "All products" }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
        />
        <SimpleSelect
          className="w-40"
          value={channel}
          onChange={(v) => setChannel(v as typeof channel)}
          options={[{ value: "all", label: "All sale types" }, ...(Object.keys(CHANNELS) as SaleChannel[]).map((c) => ({ value: c, label: CHANNELS[c].label }))]}
        />
        <SimpleSelect
          className="w-44"
          value={seller}
          onChange={setSeller}
          options={[{ value: "all", label: "Everyone" }, ...(summary?.sellers ?? []).map((s) => ({ value: s.id, label: s.name }))]}
        />
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <div className={cn("grid gap-4 sm:grid-cols-2", isOwner ? "xl:grid-cols-4" : "xl:grid-cols-2")}>
        {!summary ? (
          Array.from({ length: isOwner ? 4 : 2 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <StatCard
              label="Revenue"
              value={formatMoney(summary.revenue)}
              hint={`${formatNumber(summary.count)} sale${summary.count === 1 ? "" : "s"}${summary.refundedCount ? ` · ${summary.refundedCount} refunded` : ""}`}
              icon={DollarSign}
            />
            {isOwner && (
              <StatCard label="Profit" value={formatMoney(summary.profit ?? 0)} hint={`Cost ${formatMoney(summary.cost ?? 0)}`} icon={TrendingUp} tone={(summary.profit ?? 0) < 0 ? "red" : "green"} />
            )}
            {isOwner && (
              <StatCard label="Profit margin" value={summary.margin == null ? "—" : `${summary.margin}%`} hint="Profit as a share of revenue" icon={Percent} tone="violet" />
            )}
            <StatCard label="Units sold" value={formatNumber(summary.unitsSold)} hint="Products, not counting rentals" icon={Package} tone="amber" />
          </>
        )}
      </div>

      {summary && (
        <div className="grid gap-4 md:grid-cols-3">
          {(Object.keys(CHANNELS) as SaleChannel[]).map((c) => {
            const t = summary.channels[c]
            const Icon = CHANNELS[c].icon
            return (
              <Card key={c} size="sm">
                <CardContent className="flex items-center gap-3">
                  <Icon className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c === "rental" ? "Rental income" : CHANNELS[c].label + " sales"}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(t.count)} · {formatMoney(t.revenue)}
                      {isOwner && t.profit !== undefined && ` · profit ${formatMoney(t.profit)}`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Card className={cn(loading && data && "opacity-60 transition-opacity")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-4" />
            Sales
          </CardTitle>
          <CardDescription>
            {sales.length >= 500 ? "The newest 500 sales. Narrow the dates to see older ones; the totals above include everything." : "Newest first. Refunded sales are greyed out and not counted."}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {!data ? (
            <div className="space-y-2 px-4">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : sales.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="No sales here" description="Sales from Sell, delivered orders and returned rentals show up here." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    {isOwner && <TableHead className="text-right">Profit</TableHead>}
                    <TableHead>Type</TableHead>
                    <TableHead>Shop</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="pr-4">Sold by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((s) => (
                    <TableRow key={s.id} className={cn(s.refundedAt && "text-muted-foreground opacity-60")}>
                      <TableCell className="pl-4 text-sm whitespace-nowrap">{formatDateTime(s.soldAt)}</TableCell>
                      <TableCell className="max-w-64 font-medium">
                        <span className="line-clamp-2">{s.productName}</span>
                        {s.refundedAt && <Pill tone="red">Refunded</Pill>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(s.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {formatMoney(s.unitPrice)}
                        {s.discount > 0 && <div className="text-xs text-muted-foreground">−{formatMoney(s.discount)}</div>}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">{formatMoney(s.revenue)}</TableCell>
                      {isOwner && (
                        <TableCell className={cn("text-right tabular-nums whitespace-nowrap", (s.profit ?? 0) < 0 && "text-destructive")}>{formatMoney(s.profit ?? 0)}</TableCell>
                      )}
                      <TableCell>
                        <Pill tone={CHANNELS[s.channel].tone}>{CHANNELS[s.channel].label}</Pill>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{(s.locationId && lookups.location.get(s.locationId)?.name) || "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{(s.clientId && lookups.client.get(s.clientId)?.name) || "Walk-in"}</TableCell>
                      <TableCell className="pr-4 text-sm whitespace-nowrap">{s.soldBy || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageBody>
  )
}
