"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Boxes, CalendarClock, DollarSign, MapPinOff, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ListSkeleton, PageBody, PageHeader, Pager, QueryError, SearchInput, StatCard } from "@/components/common"
import { usePermissions, useScope, useSessionUser } from "@/components/session-provider"
import { StockPill } from "@/components/status"
import {
  PAGE_SIZE,
  qtyAt,
  useDebounced,
  usePageNumber,
  useProducts,
  useRentalSummary,
  useShipmentCounts,
  useStockSummary,
  useTransfers,
} from "@/lib/data/queries"
import { formatMoney, formatNumber } from "@/lib/format"

export function LocationDetailView({ id }: { id: string }) {
  const scope = useScope()
  const { module } = usePermissions()
  // Staff don't see orders or transfers.
  const lead = useSessionUser().role !== "staff"
  const showRentals = module("rentals")
  const showOrders = lead && module("tracking")
  const location = scope.locations.find((l) => l.id === id)
  const [query, setQuery] = useState("")
  const search = useDebounced(query.trim())
  const [page, setPage] = usePageNumber(search)
  const here = !!location
  // Products kept here (some may have run out), A to Z.
  const products = useProducts({ page, search, location: id, ordering: "name" }, { enabled: here })
  const stats = useStockSummary().data?.locations.find((l) => l.locationId === id)
  const rentals = useRentalSummary({ location: id }, here && showRentals).data
  const orders = useShipmentCounts({ location: id }, here && showOrders).data
  const incoming = useTransfers({ page: 1, to: id, status: "in_transit" }, { pageSize: 1, enabled: here && lead && module("transfers") }).data?.count ?? 0

  if (!location) {
    return (
      <PageBody>
        <EmptyState icon={MapPinOff} title="Location not found" description="It doesn't exist or isn't assigned to you." />
      </PageBody>
    )
  }

  const rows = (products.data?.results ?? []).map((product) => ({ product, quantity: qtyAt(product, id) }))
  const openOrders = orders?.filter((o) => ["pending", "processing", "in_delivery"].includes(o.status)).reduce((sum, o) => sum + o.count, 0) ?? 0

  return (
    <PageBody>
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/locations" />} nativeButton={false}>
        <ArrowLeft />
        Warehouses & shops
      </Button>
      <PageHeader title={location.name} description={`${location.type === "warehouse" ? "Warehouse" : "Shop / outlet"} · ${location.address}`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Units in stock" value={formatNumber(stats?.units ?? 0)} hint={`${formatNumber(stats?.products ?? 0)} different products`} icon={Boxes} />
        <StatCard label="Stock value (cost)" value={formatMoney(stats?.value ?? 0)} icon={DollarSign} tone="green" />
        {showRentals && <StatCard label="Active rentals" value={rentals?.active ?? 0} icon={CalendarClock} tone="violet" />}
        {showOrders && (
          <StatCard label="Open orders" value={openOrders} hint={incoming ? `${incoming} transfer(s) arriving` : undefined} icon={Truck} tone="amber" />
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Products here</CardTitle>
          <SearchInput value={query} onChange={setQuery} className="sm:w-64" />
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          {products.error && !products.data ? (
            <div className="px-4">
              <QueryError error={products.error} onRetry={() => products.refetch()} />
            </div>
          ) : products.isPending ? (
            <ListSkeleton className="px-4" />
          ) : (
          <div className={products.isPlaceholderData ? "overflow-x-auto opacity-60 transition-opacity" : "overflow-x-auto"}>
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
                {rows.map((r) => (
                  <TableRow key={r.product.id}>
                    <TableCell className="pl-4">
                      <Link href={`/products/${r.product.id}`} className="font-medium hover:underline">
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
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      {search ? "No products match." : "This location has no stock yet."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          )}
          {products.data && (
            <div className="px-4">
              <Pager page={products.data.page} pageSize={PAGE_SIZE} count={products.data.count} onPage={setPage} busy={products.isPlaceholderData} />
            </div>
          )}
        </CardContent>
      </Card>
    </PageBody>
  )
}
