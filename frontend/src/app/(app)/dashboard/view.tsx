"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, Boxes, CalendarClock, Banknote, Package, Truck } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { PageBody, PageHeader, Pill, QueryError, StatCard, MoneyTotal } from "@/components/common"
import { usePermissions, useScope, useSessionUser } from "@/components/session-provider"
import { SHIPMENT_STATUS } from "@/components/status"
import { RequestStockDialog } from "@/components/stock-request-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useOverview } from "@/lib/data/queries"
import { formatNumber, timeAgo } from "@/lib/format"
import { rentalOverdueDays } from "@/lib/rental"
import type { ShipmentStatus } from "@/lib/types"

const chartConfig = { units: { label: "Units", color: "var(--chart-1)" } } satisfies ChartConfig
const OPEN = ["pending", "processing", "in_delivery"] as const satisfies ShipmentStatus[]

export function DashboardView() {
  const user = useSessionUser()
  const scope = useScope()
  const { canOpen, module } = usePermissions()
  const [requesting, setRequesting] = useState<{ productId: string; locationId?: string } | null>(null)
  // Shops ask the warehouse for stock when transfers are on.
  const canRequest = module("transfers") && canOpen("/transfers")
  const showOrders = module("tracking")
  const showRentals = module("rentals")
  const { data: overview, error, refetch } = useOverview()
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
  const data = {
    lowStock: overview.lowStock,
    overdue: overview.overdueList ?? [],
    byStatus,
    openOrders: byStatus.reduce((sum, b) => sum + b.count, 0),
    chart: scope.locations.map((l) => ({ name: l.name, units: overview.unitsByLocation[l.id] ?? 0 })),
  }

  return (
    <PageBody>
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Products" value={formatNumber(overview.products)} hint={`${formatNumber(overview.units)} units in stock`} icon={Package} />
        <StatCard label="Stock value (cost)" value={<MoneyTotal value={overview.value} />} icon={Banknote} tone="green" />
        {showOrders && (
          <StatCard label="Open orders" value={data.openOrders} hint={`${data.byStatus[2].count} out for delivery`} icon={Truck} tone="violet" />
        )}
        {showRentals && (
          <StatCard
            label="Active rentals"
            value={overview.activeRentals ?? 0}
            hint={
              overview.overdueRentals ? (
                <span className="font-medium text-red-600 dark:text-red-400">{overview.overdueRentals} overdue</span>
              ) : (
                "None overdue"
              )
            }
            icon={CalendarClock}
            tone={overview.overdueRentals ? "red" : "amber"}
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className={showOrders ? "lg:col-span-2" : "lg:col-span-3"}>
          <CardHeader>
            <CardTitle>Units in stock by location</CardTitle>
            <CardDescription>Hover a bar for the exact number.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
              <BarChart data={data.chart} margin={{ left: 4, right: 4, top: 8 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} strokeOpacity={0.5} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} interval={0} tick={{ fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatNumber(v)} />
                <ChartTooltip cursor={{ fillOpacity: 0.08 }} content={<ChartTooltipContent hideIndicator />} />
                <Bar dataKey="units" fill="var(--color-units)" radius={[4, 4, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

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
              {data.byStatus.map(({ status, count }) => (
                <div key={status} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span>{SHIPMENT_STATUS[status].label}</span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${data.openOrders ? (count / data.openOrders) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
              {data.openOrders === 0 && <p className="text-sm text-muted-foreground">No orders in progress.</p>}
            </CardContent>
          </Card>
        )}
      </div>

      <div className={showRentals ? "grid gap-6 lg:grid-cols-3" : "grid gap-6 lg:grid-cols-2"}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              Low stock
            </CardTitle>
            <CardDescription>{overview.lowStockCount} item(s) need restocking</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.lowStock.map(({ productId, productName, locationId, quantity }) => (
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
            {data.lowStock.length === 0 && <p className="text-sm text-muted-foreground">Everything is well stocked.</p>}
            {overview.lowStockCount > data.lowStock.length && (
              <Button variant="outline" size="sm" className="w-full" render={<Link href="/inventory" />} nativeButton={false}>
                See all {overview.lowStockCount}
              </Button>
            )}
          </CardContent>
        </Card>

        {showRentals && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4 text-red-500" />
                Overdue rentals
              </CardTitle>
              <CardDescription>Items that should be back by now</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.overdue.map((r) => {
                const client = r.client
                const days = rentalOverdueDays(r) ?? 0
                return (
                  <Link key={r.id} href="/rentals" className="flex items-center justify-between gap-3 text-sm hover:underline">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.productName ?? "Deleted product"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {client?.name}
                        {client?.phone ? ` · ${client.phone}` : ""}
                      </span>
                    </span>
                    <Pill tone="red">{days}d late</Pill>
                  </Link>
                )
              })}
              {data.overdue.length === 0 && <p className="text-sm text-muted-foreground">No overdue rentals. Nice!</p>}
            </CardContent>
          </Card>
        )}

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
            {(overview.recentActivity ?? []).map((a) => (
              <div key={a.id} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{a.action}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.at)}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {a.user} · {a.detail}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {requesting && <RequestStockDialog productId={requesting.productId} locationId={requesting.locationId} onClose={() => setRequesting(null)} />}
    </PageBody>
  )
}
