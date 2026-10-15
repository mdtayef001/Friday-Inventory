"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { endOfDay, format, startOfDay, startOfMonth, subDays, subMonths } from "date-fns"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { CalendarClock, Banknote, Download, Package, Percent, Receipt, ReceiptText, ShoppingCart, Store, Trophy, TrendingUp, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, PageBody, PageHeader, Pager, Pill, SimpleSelect, StatCard, type PillTone, MoneyTotal } from "@/components/common"
import { ProductPicker } from "@/components/product-picker"
import { ReturnRequests, ReturnStatus, SaleActions } from "@/components/sale-return"
import { usePermissions, useScope } from "@/components/session-provider"
import { apiQuery, usePage, usePaging, withParams } from "@/lib/data/queries"
import { formatDateTime, formatMoney, formatMoneyShort, formatNumber } from "@/lib/format"
import type { PaymentMethod, Product, Sale, SaleChannel } from "@/lib/types"
import { PAYMENT_METHODS } from "@/lib/business"
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
  waitingCount: number
  methods: Record<PaymentMethod | "none", { count: number; revenue: number }>
  margin?: number | null
  channels: Record<SaleChannel, Totals>
  sellers: { id: string; name: string }[]
  series: { bucket: "day" | "month"; points: { date: string; revenue: number; profit?: number }[] }
  topProducts: { productId: string | null; name: string; units: number; revenue: number; profit?: number }[]
}

// Revenue solid blue, profit dashed teal: the dash keeps them apart for colour-blind
// readers too. Colours checked with the dataviz palette validator in both themes.
const chartConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  profit: { label: "Profit", theme: { light: "oklch(0.65 0.14 175)", dark: "oklch(0.66 0.13 175)" } },
} satisfies ChartConfig

type TopSort = "revenue" | "units" | "profit"

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
  const scope = useScope()
  const locationName = (id: string) => scope.locations.find((l) => l.id === id)?.name
  // Owners always; managers when the owner allows it. Django sends profit only then, too.
  const showProfit = usePermissions().can("managerProfit")
  const [topSort, setTopSort] = useState<TopSort>("revenue")

  const [period, setPeriod] = useState<Period>("30d")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [location, setLocation] = useState("all")
  const [product, setProduct] = useState<Product | null>(null)
  const [seller, setSeller] = useState("all")
  const [channel, setChannel] = useState<"all" | SaleChannel>("all")
  const [method, setMethod] = useState<"all" | PaymentMethod | "none">("all")

  const params = useMemo(() => {
    const { from, to } = range(period, customFrom, customTo)
    return {
      from: from?.toISOString(),
      to: to?.toISOString(),
      location: location === "all" ? undefined : location,
      product: product?.id,
      seller: seller === "all" ? undefined : seller,
      channel: channel === "all" ? undefined : channel,
      method: method === "all" ? undefined : method,
    }
  }, [period, customFrom, customTo, location, product, seller, channel, method])

  const summaryQuery = useQuery({ ...apiQuery<Summary>("sales/summary/", params), placeholderData: keepPreviousData })
  const paging = usePaging(params)
  const salesQuery = usePage<Sale>("sales/", { ...params, page: paging.page }, { pageSize: paging.pageSize })
  const summary = summaryQuery.data
  const list = salesQuery.data
  const sales = list?.results ?? []
  const loading = summaryQuery.isPlaceholderData || salesQuery.isPlaceholderData
  const error = summaryQuery.error ?? salesQuery.error
  const top = useMemo(
    () => [...(summary?.topProducts ?? [])].sort((a, b) => (b[topSort] ?? 0) - (a[topSort] ?? 0)).slice(0, 10),
    [summary, topSort],
  )
  const tick = (date: string) => format(new Date(date + "T00:00"), summary?.series.bucket === "month" ? "MMM yyyy" : "MMM d")

  return (
    <PageBody>
      <PageHeader
        title="Sales"
        description={showProfit ? "What you sold, what it earned and what you kept." : "What your shops sold."}
        actions={
          <Button variant="outline" render={<a href={`/api/backend/${withParams("sales/export/", params)}`} download />} nativeButton={false}>
            <Download />
            Export CSV
          </Button>
        }
      />

      <ReturnRequests />

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
        <ProductPicker className="w-52" value={product} onChange={setProduct} allLabel="All products" onAll={() => setProduct(null)} />
        <SimpleSelect
          className="w-40"
          value={channel}
          onChange={(v) => setChannel(v as typeof channel)}
          options={[{ value: "all", label: "All sale types" }, ...(Object.keys(CHANNELS) as SaleChannel[]).map((c) => ({ value: c, label: CHANNELS[c].label }))]}
        />
        <SimpleSelect
          className="w-40"
          value={method}
          onChange={(v) => setMethod(v as typeof method)}
          options={[
            { value: "all", label: "Any payment" },
            ...(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((m) => ({ value: m, label: PAYMENT_METHODS[m].short })),
            { value: "none", label: "Not recorded" },
          ]}
        />
        <SimpleSelect
          className="w-44"
          value={seller}
          onChange={setSeller}
          options={[{ value: "all", label: "Everyone" }, ...(summary?.sellers ?? []).map((s) => ({ value: s.id, label: s.name }))]}
        />
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error.message}</p>}

      <div className={cn("grid gap-4 sm:grid-cols-2", showProfit ? "xl:grid-cols-4" : "xl:grid-cols-2")}>
        {!summary ? (
          Array.from({ length: showProfit ? 4 : 2 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <StatCard
              label="Revenue"
              value={<MoneyTotal value={summary.revenue} />}
              hint={`${formatNumber(summary.count)} sale${summary.count === 1 ? "" : "s"}${summary.refundedCount ? ` · ${summary.refundedCount} refunded` : ""}${summary.waitingCount ? ` · ${summary.waitingCount} waiting for payment` : ""}`}
              icon={Banknote}
            />
            {showProfit && (
              <StatCard label="Profit" value={<MoneyTotal value={summary.profit ?? 0} />} hint={`Cost ${formatMoneyShort(summary.cost ?? 0)}`} icon={TrendingUp} tone={(summary.profit ?? 0) < 0 ? "red" : "green"} />
            )}
            {showProfit && (
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
                      {showProfit && t.profit !== undefined && ` · profit ${formatMoney(t.profit)}`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {summary && (
        <div className={cn("grid gap-4 lg:grid-cols-3", loading && "opacity-60 transition-opacity")}>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="size-4" />
                {showProfit ? "Revenue and profit" : "Revenue"}
              </CardTitle>
              <CardDescription>
                Per {summary.series.bucket}. Hover for the exact amounts; the table below lists every sale.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summary.series.points.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">No sales in this period.</p>
              ) : (
                <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
                  <LineChart data={summary.series.points} margin={{ left: 4, right: 12, top: 8 }}>
                    <CartesianGrid vertical={false} strokeOpacity={0.5} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={tick} />
                    <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={formatMoneyShort} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(_, payload) => (payload?.[0] ? tick(String(payload[0].payload.date)) : "")}
                          formatter={(value, name) => (
                            <div className="flex w-full items-center justify-between gap-4">
                              <span className="text-muted-foreground">{chartConfig[name as keyof typeof chartConfig]?.label ?? name}</span>
                              <span className="font-medium tabular-nums">{formatMoney(Number(value))}</span>
                            </div>
                          )}
                        />
                      }
                    />
                    {showProfit && <ChartLegend content={<ChartLegendContent />} itemSorter={(item) => (item.dataKey === "revenue" ? 0 : 1)} />}
                    <Line dataKey="revenue" type="linear" stroke="var(--color-revenue)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    {showProfit && (
                      <Line dataKey="profit" type="linear" stroke="var(--color-profit)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} />
                    )}
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="size-4" />
                Top products
              </CardTitle>
              <CardDescription>Products sold in this period, not rentals.</CardDescription>
              <div className="flex gap-1 pt-1">
                {(["revenue", "units", ...(showProfit ? ["profit"] : [])] as TopSort[]).map((k) => (
                  <Button key={k} size="xs" variant={topSort === k ? "secondary" : "ghost"} onClick={() => setTopSort(k)}>
                    {k === "units" ? "Units" : k === "revenue" ? "Revenue" : "Profit"}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {top.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nothing sold yet.</p>
              ) : (
                <ol className="space-y-3">
                  {top.map((p, i) => (
                    <li key={p.productId ?? "deleted"} className="flex items-center gap-3 text-sm">
                      <span className="w-4 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(p.units)} sold · {formatMoney(p.revenue)}
                        </p>
                      </div>
                      {showProfit && p.profit !== undefined && (
                        <span className={cn("text-xs font-medium tabular-nums", p.profit < 0 ? "text-destructive" : "text-muted-foreground")}>
                          {formatMoney(Math.abs(p.profit))} {p.profit < 0 ? "loss" : "profit"}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {summary && (
        <Card size="sm">
          <CardContent className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span className="font-medium">How it was paid</span>
            {(["cash", "mobile", "card", "online", "none"] as const)
              .filter((m) => summary.methods[m]?.count)
              .map((m) => (
                <span key={m} className="tabular-nums">
                  <span className="text-muted-foreground">{m === "none" ? "Not recorded" : PAYMENT_METHODS[m].short}</span> {formatMoney(summary.methods[m].revenue)}
                  <span className="text-muted-foreground"> · {summary.methods[m].count}</span>
                </span>
              ))}
            {Object.values(summary.methods).every((m) => !m.count) && <span className="text-muted-foreground">No paid sales in this view.</span>}
          </CardContent>
        </Card>
      )}

      <Card className={cn(loading && "opacity-60 transition-opacity")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-4" />
            Sales
          </CardTitle>
          <CardDescription>Newest first. Refunded sales are greyed out and not counted. Use ⋯ on a shop sale to return it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          {!list ? (
            <div className="space-y-2 px-4">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : sales.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="No sales here" description="Sales from Sell, delivered orders and returned rentals show up here." />
          ) : (
            <div className="overflow-x-auto">
              <Table scroll>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    {showProfit && <TableHead className="text-right">Profit</TableHead>}
                    <TableHead>Type</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Shop</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Sold by</TableHead>
                    <TableHead>Receipt</TableHead>
                    {/* Pinned to the right edge: the table scrolls sideways on most screens. */}
                    <TableHead className="sticky right-0 z-10 w-10 bg-card pr-4 shadow-[-1px_0_0_var(--border)]">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((s) => (
                    <TableRow key={s.id} className={cn((s.refundedAt || s.paymentStatus !== "paid") && "text-muted-foreground opacity-60")}>
                      <TableCell className="pl-4 text-sm whitespace-nowrap">{formatDateTime(s.soldAt)}</TableCell>
                      <TableCell className="max-w-64 font-medium">
                        <span className="line-clamp-2">{s.productName}</span>
                        <ReturnStatus sale={s} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(s.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {formatMoney(s.unitPrice)}
                        {s.discount > 0 && <div className="text-xs text-muted-foreground">−{formatMoney(s.discount)}</div>}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">{formatMoney(s.revenue)}</TableCell>
                      {showProfit && (
                        <TableCell className={cn("text-right tabular-nums whitespace-nowrap", (s.profit ?? 0) < 0 && "text-destructive")}>{formatMoney(s.profit ?? 0)}</TableCell>
                      )}
                      <TableCell>
                        <Pill tone={CHANNELS[s.channel].tone}>{CHANNELS[s.channel].label}</Pill>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        <PaymentCell sale={s} />
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{(s.locationId && locationName(s.locationId)) || "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{s.clientName || "Walk-in"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{s.soldBy || "—"}</TableCell>
                      <TableCell>
                        <ReceiptLink sale={s} />
                      </TableCell>
                      <TableCell className="sticky right-0 z-10 bg-card pr-4 shadow-[-1px_0_0_var(--border)]">
                        <SaleActions sale={s} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {list && (
            <div className="px-4">
              <Pager page={list.page} pageSize={paging.pageSize} count={list.count} onPage={paging.setPage} onPageSize={paging.setPageSize} busy={salesQuery.isPlaceholderData} />
            </div>
          )}
        </CardContent>
      </Card>
    </PageBody>
  )
}

/** Opens the sale's receipt in a new tab, to print or send. Shared with My Sales. */
export function ReceiptLink({ sale: s }: { sale: Sale }) {
  if (!s.receiptNo) return <span className="text-sm text-muted-foreground">—</span>
  return (
    <Link
      href={`/receipt/${s.id}`}
      target="_blank"
      className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap underline-offset-2 hover:underline"
      title="Open the receipt to print or send"
    >
      <ReceiptText className="size-3.5 shrink-0" />
      {s.receiptNo}
    </Link>
  )
}

/** "Cash", "Online · BKASH", or the payment state when it isn't paid. Shared with My Sales. */
export function PaymentCell({ sale: s }: { sale: Sale }) {
  if (s.paymentStatus === "pending") return <Pill tone="amber">Waiting for payment</Pill>
  if (s.paymentStatus === "failed") return <Pill tone="red">Payment failed</Pill>
  if (s.paymentStatus === "cancelled") return <Pill tone="gray">Cancelled</Pill>
  if (!s.paymentMethod) return <span className="text-muted-foreground">—</span>
  const label = PAYMENT_METHODS[s.paymentMethod].short
  return <span title={s.gatewayMethod || undefined}>{s.gatewayMethod ? `${label} · ${s.gatewayMethod.split(/[-·]/)[0].trim()}` : label}</span>
}
