"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Boxes, CalendarClock, DollarSign, MapPinOff, Search, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, PageBody, PageHeader, StatCard } from "@/components/common"
import { useScope } from "@/components/session-provider"
import { StockPill } from "@/components/status"
import { formatMoney, formatNumber } from "@/lib/format"
import { useStore } from "@/lib/store"
import { useLookups } from "@/lib/store/hooks"

export function LocationDetailView({ id }: { id: string }) {
  const scope = useScope()
  const location = useStore((s) => s.locations.find((l) => l.id === id))
  const stock = useStore((s) => s.stock)
  const rentals = useStore((s) => s.rentals)
  const shipments = useStore((s) => s.shipments)
  const transfers = useStore((s) => s.transfers)
  const lookups = useLookups()
  const [query, setQuery] = useState("")

  const rows = useMemo(
    () =>
      stock
        .filter((s) => s.locationId === id)
        .map((s) => ({ ...s, product: lookups.product.get(s.productId)! }))
        .filter((r) => r.product)
        .sort((a, b) => a.product.name.localeCompare(b.product.name)),
    [stock, id, lookups],
  )

  if (!location || !scope.has(id)) {
    return (
      <PageBody>
        <EmptyState icon={MapPinOff} title="Location not found" description="It doesn't exist or isn't assigned to you." />
      </PageBody>
    )
  }

  const units = rows.reduce((s, r) => s + r.quantity, 0)
  const value = rows.reduce((s, r) => s + r.quantity * r.product.cost, 0)
  const activeRentals = rentals.filter((r) => r.locationId === id && r.status === "active").length
  const openShipments = shipments.filter((s) => s.fromLocationId === id && ["pending", "processing", "in_delivery"].includes(s.status)).length
  const incoming = transfers.filter((t) => t.toLocationId === id && t.status === "in_transit")
  const q = query.trim().toLowerCase()
  const visible = rows.filter((r) => !q || r.product.name.toLowerCase().includes(q) || r.product.sku.toLowerCase().includes(q))

  return (
    <PageBody>
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/locations" />} nativeButton={false}>
        <ArrowLeft />
        Warehouses & shops
      </Button>
      <PageHeader title={location.name} description={`${location.type === "warehouse" ? "Warehouse" : "Shop / outlet"} · ${location.address}`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Units in stock" value={formatNumber(units)} hint={`${rows.length} different products`} icon={Boxes} />
        <StatCard label="Stock value (cost)" value={formatMoney(value)} icon={DollarSign} tone="green" />
        <StatCard label="Active rentals" value={activeRentals} icon={CalendarClock} tone="violet" />
        <StatCard label="Open orders" value={openShipments} hint={incoming.length ? `${incoming.length} transfer(s) arriving` : undefined} icon={Truck} tone="amber" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Products here</CardTitle>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="pr-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.productId}>
                    <TableCell className="pl-4">
                      <Link href={`/products/${r.productId}`} className="font-medium hover:underline">
                        {r.product.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{r.product.sku}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.product.category}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(r.quantity)} <span className="text-xs text-muted-foreground">{r.product.unit}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.quantity * r.product.cost)}</TableCell>
                    <TableCell className="pr-4">
                      <StockPill quantity={r.quantity} threshold={r.product.lowStockThreshold} />
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      {rows.length === 0 ? "This location has no stock yet." : "No products match."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </PageBody>
  )
}
