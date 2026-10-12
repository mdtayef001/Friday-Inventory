"use client"

import { useMemo } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, Boxes, CalendarClock, DollarSign, Package, Truck } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { PageBody, PageHeader, Pill, StatCard } from "@/components/common"
import { usePermissions, useScope, useSessionUser } from "@/components/session-provider"
import { SHIPMENT_STATUS } from "@/components/status"
import { formatMoney, formatNumber, timeAgo } from "@/lib/format"
import { isOverdue, rentalOverdueDays } from "@/lib/rental"
import { qtyAt, useStore } from "@/lib/store"
import { useLookups } from "@/lib/store/hooks"
import type { ShipmentStatus } from "@/lib/types"

const chartConfig = { units: { label: "Units", color: "var(--chart-1)" } } satisfies ChartConfig
const OPEN: ShipmentStatus[] = ["pending", "processing", "in_delivery"]

export function DashboardView() {
  const user = useSessionUser()
  const scope = useScope()
  const { canOpen, module } = usePermissions()
  const showOrders = module("tracking")
  const showRentals = module("rentals")
  const products = useStore((s) => s.products)
  const stock = useStore((s) => s.stock)
  const rentals = useStore((s) => s.rentals)
  const shipments = useStore((s) => s.shipments)
  const activity = useStore((s) => s.activity)
  const lookups = useLookups()

  const data = useMemo(() => {
    const scopedStock = stock.filter((s) => scope.has(s.locationId))
    const units = scopedStock.reduce((sum, s) => sum + s.quantity, 0)
    const value = scopedStock.reduce((sum, s) => sum + s.quantity * (lookups.product.get(s.productId)?.cost ?? 0), 0)

    // Running low where a product is actually kept, plus products with none left anywhere.
    // A shop that never carries an item isn't "out" of it.
    const runningLow = scope.locations.flatMap((l) =>
      products
        .map((p) => ({ product: p, location: l.name, quantity: qtyAt(stock, p.id, l.id) }))
        .filter((r) => r.quantity > 0 && r.quantity <= r.product.lowStockThreshold),
    )
    const outEverywhere = products
      .filter((p) => scope.locations.every((l) => qtyAt(stock, p.id, l.id) === 0))
      .map((p) => ({ product: p, location: "All locations", quantity: 0 }))
    const lowStock = [...outEverywhere, ...runningLow.sort((a, b) => a.quantity - b.quantity)]

    const myRentals = rentals.filter((r) => scope.has(r.locationId))
    const active = myRentals.filter((r) => r.status === "active")
    const overdue = active.filter((r) => isOverdue(r)).sort((a, b) => (rentalOverdueDays(b) ?? 0) - (rentalOverdueDays(a) ?? 0))

    const myShipments = shipments.filter((s) => scope.has(s.fromLocationId))
    const byStatus = OPEN.map((status) => ({ status, count: myShipments.filter((s) => s.status === status).length }))

    const chart = scope.locations.map((l) => ({
      name: l.name,
      units: scopedStock.filter((s) => s.locationId === l.id).reduce((sum, s) => sum + s.quantity, 0),
    }))

    return { units, value, lowStock, active, overdue, byStatus, openOrders: byStatus.reduce((s, b) => s + b.count, 0), chart }
  }, [stock, products, rentals, shipments, scope, lookups])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"

  return (
    <PageBody>
      <PageHeader
        title={`${greeting}, ${user.name.split(" ")[0]}`}
        description={
          scope.isOwner
            ? "Here's what's happening across all your locations."
            : `Here's what's happening at ${scope.locations.map((l) => l.name).join(" & ")}.`
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Products" value={formatNumber(products.length)} hint={`${formatNumber(data.units)} units in stock`} icon={Package} />
        <StatCard label="Stock value (cost)" value={formatMoney(data.value)} icon={DollarSign} tone="green" />
        {showOrders && (
          <StatCard label="Open orders" value={data.openOrders} hint={`${data.byStatus[2].count} out for delivery`} icon={Truck} tone="violet" />
        )}
        {showRentals && (
          <StatCard
            label="Active rentals"
            value={data.active.length}
            hint={
              data.overdue.length ? <span className="font-medium text-red-600 dark:text-red-400">{data.overdue.length} overdue</span> : "None overdue"
            }
            icon={CalendarClock}
            tone={data.overdue.length ? "red" : "amber"}
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
            <CardDescription>{data.lowStock.length} item(s) need restocking</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.lowStock.slice(0, 6).map(({ product, location, quantity }) => (
              <Link
                key={product.id + location}
                href={`/products/${product.id}`}
                className="flex items-center justify-between gap-3 rounded-lg text-sm hover:underline"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{product.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{location}</span>
                </span>
                {quantity === 0 ? <Pill tone="red">Out</Pill> : <Pill tone="amber">{quantity} left</Pill>}
              </Link>
            ))}
            {data.lowStock.length === 0 && <p className="text-sm text-muted-foreground">Everything is well stocked.</p>}
            {data.lowStock.length > 6 && (
              <Button variant="outline" size="sm" className="w-full" render={<Link href="/inventory" />} nativeButton={false}>
                See all {data.lowStock.length}
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
              {data.overdue.slice(0, 6).map((r) => {
                const client = lookups.client.get(r.clientId)
                const days = rentalOverdueDays(r) ?? 0
                return (
                  <Link key={r.id} href="/rentals" className="flex items-center justify-between gap-3 text-sm hover:underline">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{lookups.product.get(r.productId)?.name}</span>
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
            {activity.slice(0, 6).map((a) => (
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
    </PageBody>
  )
}
