"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { format, startOfDay, subDays } from "date-fns"
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Factory,
  type LucideIcon,
  Package,
  PackageX,
  Receipt,
  Repeat,
  TrendingUp,
  Truck,
  Undo2,
  Wallet,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { PageBody, PageHeader, Pill, QueryError, StatCard, MoneyTotal, TimeAgo } from "@/components/common"
import { usePermissions, useScope, useSessionUser } from "@/components/session-provider"
import { SHIPMENT_STATUS } from "@/components/status"
import { RequestStockDialog } from "@/components/stock-request-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { apiQuery, useOverview, useSupplierPaymentSummary, useSupplierReturnSummary } from "@/lib/data/queries"
import { formatMoney, formatMoneyShort, formatNumber } from "@/lib/format"
import { rentalOverdueDays } from "@/lib/rental"
import { cn } from "@/lib/utils"
import type { ShipmentStatus } from "@/lib/types"

const stockChart = { units: { label: "Units", color: "var(--chart-1)" } } satisfies ChartConfig
// Same colours as the Sales page: revenue solid blue, profit dashed teal.
const salesChart = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  profit: { label: "Profit", theme: { light: "oklch(0.65 0.14 175)", dark: "oklch(0.66 0.13 175)" } },
} satisfies ChartConfig
const OPEN = ["pending", "processing", "in_delivery"] as const satisfies ShipmentStatus[]
const DAYS = 30

/** The part of GET sales/summary/ the dashboard uses. Profit only when the user may see it. */
interface SalesSummary {
  count: number
  revenue: number
  profit?: number
  margin?: number | null
  series: { points: { date: string; revenue: number; profit?: number }[] }
  topProducts: { productId: string | null; name: string; units: number; revenue: number }[]
}

export function DashboardView() {
  const user = useSessionUser()
  const scope = useScope()
  const { canOpen, module, can } = usePermissions()
  const [requesting, setRequesting] = useState<{ productId: string; locationId?: string } | null>(null)
  // Shops ask the warehouse for stock when transfers are on.
  const canRequest = module("transfers") && canOpen("/transfers")
  const showOrders = module("tracking")
  const showRentals = module("rentals")
  const showSales = canOpen("/sales")
  const showProfit = can("managerProfit")
  const showPurchases = canOpen("/purchases")
  const isOwner = user.role === "owner"

  const { data: overview, error, refetch } = useOverview()
  // The last 30 days, today included. Fixed when the page opens so the query key doesn't change.
  const [since] = useState(() => startOfDay(subDays(new Date(), DAYS - 1)).toISOString())
  const sales = useQuery({ ...apiQuery<SalesSummary>("sales/summary/", { from: since }), enabled: showSales }).data
  const owed = useSupplierPaymentSummary(isOwner && showPurchases).data
  const owedBack = useSupplierReturnSummary(showPurchases).data

  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const locationName = new Map(scope.locations.map((l) => [l.id, l.name]))

  const header = (
    <PageHeader
      title={`${greeting}, ${user.name.split(" ")[0]}`}
      description={
        scope.isOwner
          ? "Here's what's happening across all your locations."
          : `Here's what's happening at ${scope.locations.map((l) => l.name).join(" & ")}.`
      }
    />
  )
  if (!overview) {
    return (
      <PageBody>
        {header}
        {error ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        )}
      </PageBody>
    )
  }

  const byStatus = OPEN.map((status) => ({ status, count: overview.ordersByStatus?.find((o) => o.status === status)?.count ?? 0 }))
  const openOrders = byStatus.reduce((sum, b) => sum + b.count, 0)
  const overdue = overview.overdueList ?? []
  const points = sales?.series.points ?? []
  const today = points.at(-1)?.revenue ?? 0
  const yesterday = points.at(-2)?.revenue ?? 0
  const stockByLocation = scope.locations.map((l) => ({ name: l.name, units: overview.unitsByLocation[l.id] ?? 0 }))
  const tick = (date: string) => format(new Date(date + "T00:00"), "MMM d")

  // Everything waiting on someone, biggest worries first. Only what's switched on and allowed.
  const attention: { href: string; icon: LucideIcon; label: string; detail?: string; tone: "red" | "amber" | "blue" }[] = []
  if (owed && owed.overdue > 0) attention.push({ href: "/suppliers", icon: Wallet, label: "Supplier bills overdue", detail: formatMoney(owed.overdue), tone: "red" })
  if (overview.overdueRentals) attention.push({ href: "/rentals", icon: CalendarClock, label: "Rentals overdue", detail: formatNumber(overview.overdueRentals), tone: "red" })
  if (overview.lowStockCount) attention.push({ href: "/inventory", icon: AlertTriangle, label: "Products low or out of stock", detail: formatNumber(overview.lowStockCount), tone: "amber" })
  if (overview.returnRequests) attention.push({ href: "/sales", icon: Undo2, label: "Refunds asked for by staff", detail: formatNumber(overview.returnRequests), tone: "amber" })
  if (overview.waitingRequests && canOpen("/transfers"))
    attention.push({ href: "/transfers?tab=requests", icon: Repeat, label: "Stock requests waiting", detail: formatNumber(overview.waitingRequests), tone: "amber" })
  if (owedBack && owedBack.openCount > 0)
    attention.push({ href: "/supplier-returns", icon: PackageX, label: "Returns waiting on suppliers", detail: `${owedBack.openCount} · ${formatMoney(owedBack.owed)} back`, tone: "blue" })
  if (showOrders && openOrders) attention.push({ href: "/tracking", icon: Truck, label: "Orders on their way", detail: formatNumber(openOrders), tone: "blue" })

  const sideLists = showOrders || (showRentals && overdue.length > 0)
  const showActivity = !!overview.recentActivity

  return (
    <PageBody>
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {showSales && (
          <StatCard
            label="Sales today"
            value={sales ? <MoneyTotal value={today} /> : "…"}
            hint={sales ? `Yesterday ${formatMoney(yesterday)}` : undefined}
            icon={Receipt}
            tone="green"
          />
        )}
        {showSales && (
          <StatCard
            label={`Last ${DAYS} days`}
            value={sales ? <MoneyTotal value={sales.revenue} /> : "…"}
            hint={
              sales &&
              (showProfit && sales.profit !== undefined
                ? `${formatMoney(sales.profit)} profit${sales.margin != null ? ` · ${sales.margin}%` : ""}`
                : `${formatNumber(sales.count)} sales`)
            }
            icon={TrendingUp}
          />
        )}
        <StatCard
          label="Stock value (cost)"
          value={<MoneyTotal value={overview.value} />}
          hint={`${formatNumber(overview.products)} products · ${formatNumber(overview.units)} units`}
          icon={Banknote}
          tone="violet"
        />
        {owed ? (
          <StatCard
            label="You owe suppliers"
            value={<MoneyTotal value={owed.owed} />}
            hint={
              owed.overdue > 0 ? (
                <span className="font-medium text-red-600 dark:text-red-400">{formatMoney(owed.overdue)} overdue</span>
              ) : owed.owed > 0 ? (
                `To ${owed.supplierCount} supplier${owed.supplierCount === 1 ? "" : "s"}, nothing overdue`
              ) : (
                "All bills paid"
              )
            }
            icon={Factory}
            tone={owed.overdue > 0 ? "red" : owed.owed > 0 ? "amber" : "green"}
          />
        ) : showOrders ? (
          <StatCard label="Open orders" value={openOrders} hint={`${byStatus[2].count} out for delivery`} icon={Truck} tone="violet" />
        ) : showRentals ? (
          <StatCard
            label="Active rentals"
            value={overview.activeRentals ?? 0}
            hint={overview.overdueRentals ? `${overview.overdueRentals} overdue` : "None overdue"}
            icon={CalendarClock}
            tone={overview.overdueRentals ? "red" : "amber"}
          />
        ) : (
          !showSales && <StatCard label="Products" value={formatNumber(overview.products)} hint={`${formatNumber(overview.units)} units in stock`} icon={Package} />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {showSales && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{showProfit ? "Revenue and profit" : "Revenue"}</CardTitle>
              <CardDescription>Each day for the last {DAYS} days. Hover for the exact amounts.</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" render={<Link href="/sales" />} nativeButton={false}>
                  Sales
                  <ArrowRight />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {!sales ? (
                <Skeleton className="h-64 w-full" />
              ) : sales.count === 0 ? (
                <p className="py-24 text-center text-sm text-muted-foreground">No sales in the last {DAYS} days yet.</p>
              ) : (
                <ChartContainer config={salesChart} className="aspect-auto h-64 w-full">
                  <LineChart data={points} margin={{ left: 4, right: 12, top: 8 }}>
                    <CartesianGrid vertical={false} strokeOpacity={0.5} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={tick} />
                    <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={formatMoneyShort} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(_, payload) => (payload?.[0] ? tick(String(payload[0].payload.date)) : "")}
                          formatter={(value, name) => (
                            <div className="flex w-full items-center justify-between gap-4">
                              <span className="text-muted-foreground">{salesChart[name as keyof typeof salesChart]?.label ?? name}</span>
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
        )}

        <Card className={showSales ? undefined : "lg:col-span-3"}>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>{attention.length ? "Open one to deal with it." : "Nothing waiting on you."}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1">
            {attention.map((a) => (
              <Link key={a.label} href={a.href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    a.tone === "red" && "bg-red-500/10 text-red-600 dark:text-red-400",
                    a.tone === "amber" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                    a.tone === "blue" && "bg-primary/10 text-primary",
                  )}
                >
                  <a.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 font-medium">{a.label}</span>
                {a.detail && <span className="shrink-0 text-right tabular-nums text-muted-foreground">{a.detail}</span>}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
            {attention.length === 0 && (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-emerald-600" />
                All caught up.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className={cn("grid gap-6", [showSales, true, showActivity].filter(Boolean).length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
        {showSales && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="size-4 text-primary" />
                Top sellers
              </CardTitle>
              <CardDescription>Last {DAYS} days, by revenue</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(sales?.topProducts ?? []).slice(0, 6).map((p, i) => (
                <div key={p.productId ?? p.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    {p.productId ? (
                      <Link href={`/products/${p.productId}`} className="truncate font-medium hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="truncate font-medium">{p.name}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-medium tabular-nums">{formatMoney(p.revenue)}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{formatNumber(p.units)} sold</span>
                  </span>
                </div>
              ))}
              {sales && sales.topProducts.length === 0 && <p className="text-sm text-muted-foreground">Nothing sold yet.</p>}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              Low stock
            </CardTitle>
            <CardDescription>{overview.lowStockCount} item(s) need restocking</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview.lowStock.map(({ productId, productName, locationId, quantity }) => (
              <div key={`${productId}-${locationId}`} className="flex items-center justify-between gap-3 text-sm">
                <Link href={`/products/${productId}`} className="min-w-0 rounded-lg hover:underline">
                  <span className="block truncate font-medium">{productName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{locationId ? locationName.get(locationId) : "All locations"}</span>
                </Link>
                <span className="flex shrink-0 items-center gap-2">
                  {quantity === 0 ? <Pill tone="red">Out</Pill> : <Pill tone="amber">{quantity} left</Pill>}
                  {canRequest && (
                    <Button size="xs" variant="outline" onClick={() => setRequesting({ productId, locationId: locationId ?? undefined })}>
                      Request
                    </Button>
                  )}
                </span>
              </div>
            ))}
            {overview.lowStock.length === 0 && <p className="text-sm text-muted-foreground">Everything is well stocked.</p>}
            {overview.lowStockCount > overview.lowStock.length && (
              <Button variant="outline" size="sm" className="w-full" render={<Link href="/inventory" />} nativeButton={false}>
                See all {overview.lowStockCount}
              </Button>
            )}
          </CardContent>
        </Card>

        {showActivity && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Boxes className="size-4 text-primary" />
                Recent activity
              </CardTitle>
              {canOpen("/activity") && (
                <CardAction>
                  <Button variant="ghost" size="sm" render={<Link href="/activity" />} nativeButton={false}>
                    All
                    <ArrowRight />
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.recentActivity!.map((a) => (
                <div key={a.id} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{a.action}</span>
                    <span className="shrink-0 text-xs text-muted-foreground"><TimeAgo at={a.at} /></span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.user} · {a.detail}
                  </p>
                </div>
              ))}
              {overview.recentActivity!.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
            </CardContent>
          </Card>
        )}
      </div>

      {/* items-start: the chart keeps its own height when the lists beside it are long. */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className={sideLists ? "lg:col-span-2" : "lg:col-span-3"}>
          <CardHeader>
            <CardTitle>Units in stock by location</CardTitle>
            <CardDescription>Hover a bar for the exact number.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={stockChart} className="aspect-auto h-64 w-full">
              <BarChart data={stockByLocation} margin={{ left: 4, right: 4, top: 8 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} strokeOpacity={0.5} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} interval={0} tick={{ fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatNumber(v)} />
                <ChartTooltip cursor={{ fillOpacity: 0.08 }} content={<ChartTooltipContent hideIndicator />} />
                <Bar dataKey="units" fill="var(--color-units)" radius={[4, 4, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {sideLists && (
          <div className="grid content-start gap-6">
            {showOrders && (
              <Card>
                <CardHeader>
                  <CardTitle>Orders in progress</CardTitle>
                  <CardAction>
                    <Button variant="ghost" size="sm" render={<Link href="/tracking" />} nativeButton={false}>
                      View
                      <ArrowRight />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-4">
                  {byStatus.map(({ status, count }) => (
                    <div key={status} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span>{SHIPMENT_STATUS[status].label}</span>
                        <span className="font-medium tabular-nums">{count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${openOrders ? (count / openOrders) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))}
                  {openOrders === 0 && <p className="text-sm text-muted-foreground">No orders in progress.</p>}
                </CardContent>
              </Card>
            )}

            {showRentals && overdue.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarClock className="size-4 text-red-500" />
                    Overdue rentals
                  </CardTitle>
                  <CardDescription>Items that should be back by now</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {overdue.map((r) => (
                    <Link key={r.id} href={`/rentals?q=${encodeURIComponent(r.code)}`} className="flex items-center justify-between gap-3 text-sm hover:underline">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.productName ?? "Deleted product"}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {r.client?.name}
                          {r.client?.phone ? ` · ${r.client.phone}` : ""}
                        </span>
                      </span>
                      <Pill tone="red">{rentalOverdueDays(r) ?? 0}d late</Pill>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
      {requesting && <RequestStockDialog productId={requesting.productId} locationId={requesting.locationId} onClose={() => setRequesting(null)} />}
    </PageBody>
  )
}
