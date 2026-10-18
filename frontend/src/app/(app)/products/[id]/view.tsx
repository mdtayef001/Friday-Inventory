"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Boxes, CalendarClock, Banknote, PackageX, Pencil, Plus, Printer, ShoppingCart, Truck, Warehouse } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ListSkeleton, PageBody, PageHeader, Pill, QueryError, StatCard, MoneyTotal } from "@/components/common"
import { usePermissions, useScope, useSessionUser } from "@/components/session-provider"
import { RentalStatusPill, ShipmentStatusPill, StockPill } from "@/components/status"
import { useAddToCart } from "@/components/cart"
import { SellDialog } from "@/components/sell-dialog"
import { StockAdjustDialog } from "@/components/stock-adjust-dialog"
import { ApiError } from "@/lib/api/errors"
import { qtyAt, useProduct, useRentalSummary, useRentals, useShipments } from "@/lib/data/queries"
import { formatDate, formatMoney, formatNumber } from "@/lib/format"
import { isOverdue } from "@/lib/rental"

export function ProductDetailView({ id }: { id: string }) {
  const scope = useScope()
  const { can, module } = usePermissions()
  const canEdit = can("managerProducts")
  const showOrders = useSessionUser().role !== "staff" && module("tracking")
  const showRentals = module("rentals")
  const { data: product, error, refetch } = useProduct(id)
  const orders = useShipments({ page: 1, product: id }, { pageSize: 5, enabled: showOrders })
  const rentals = useRentals({ page: 1, product: id }, { pageSize: 5, enabled: showRentals })
  const rentalSummary = useRentalSummary({ product: id }, showRentals).data
  const [adjust, setAdjust] = useState<{ locationId?: string; key: number } | null>(null)
  const [selling, setSelling] = useState(false)
  const addToCart = useAddToCart()
  const qrRef = useRef<HTMLDivElement>(null)

  if (error && !(error instanceof ApiError && error.status === 404)) {
    return (
      <PageBody>
        <QueryError error={error} onRetry={() => refetch()} />
      </PageBody>
    )
  }
  if (!product && !error) {
    return (
      <PageBody>
        <ListSkeleton />
      </PageBody>
    )
  }
  if (!product) {
    return (
      <PageBody>
        <EmptyState
          icon={PackageX}
          title="Product not found"
          description="It may have been deleted."
          action={
            <Button render={<Link href="/products" />} nativeButton={false}>
              Back to products
            </Button>
          }
        />
      </PageBody>
    )
  }

  const perLocation = scope.locations.map((l) => ({ location: l, quantity: qtyAt(product, l.id) }))
  const total = product.total ?? 0
  const rented = rentalSummary?.activeUnits ?? 0
  const code = product.barcode || product.sku

  function printLabel() {
    const svg = qrRef.current?.querySelector("svg")?.outerHTML
    const win = window.open("", "_blank", "width=400,height=500")
    if (!svg || !win || !product) return
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
    win.document.write(`<!doctype html><title>Label</title><body style="font-family:sans-serif;text-align:center;padding:24px">
      ${svg}<h3 style="margin:12px 0 4px">${esc(product.name)}</h3><code>${esc(code)}</code>
      <p style="margin:4px 0">${esc(formatMoney(product.price))}</p></body>`)
    win.document.close()
    win.focus()
    win.print()
  }

  return (
    <PageBody>
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/products" />} nativeButton={false}>
        <ArrowLeft />
        Products
      </Button>
      <PageHeader
        title={product.name}
        description={`${product.category} · SKU ${product.sku}${product.barcode ? ` · Barcode ${product.barcode}` : ""}`}
        actions={
          <>
            {canEdit && (
              <Button variant="outline" render={<Link href={`/products/${id}/edit`} />} nativeButton={false}>
                <Pencil />
                Edit
              </Button>
            )}
            <Button variant="outline" onClick={() => setAdjust({ key: Date.now() })}>
              <Boxes />
              Update stock
            </Button>
            <Button variant="outline" onClick={() => addToCart(product)} disabled={total === 0}>
              <Plus />
              Add to cart
            </Button>
            <Button onClick={() => setSelling(true)} disabled={total === 0}>
              <ShoppingCart />
              Sell
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="In stock" value={`${formatNumber(total)} ${product.unit}`} hint={<StockPill quantity={total} threshold={product.lowStockThreshold} />} icon={Boxes} />
        <StatCard label="Stock value (cost)" value={<MoneyTotal value={total * product.cost} />} hint={`Cost ${formatMoney(product.cost)} each`} icon={Banknote} tone="green" />
        <StatCard label="Selling price" value={formatMoney(product.price)} hint={`Margin ${formatMoney(product.price - product.cost)}`} icon={Banknote} tone="violet" />
        <StatCard
          label="Out on rent"
          value={product.rentable ? `${rented} ${product.unit}` : "Not rentable"}
          hint={
            product.rentable
              ? [
                  product.rentRates?.daily && `${formatMoney(product.rentRates.daily)}/day`,
                  product.rentRates?.weekly && `${formatMoney(product.rentRates.weekly)}/wk`,
                  product.rentRates?.monthly && `${formatMoney(product.rentRates.monthly)}/mo`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
          icon={CalendarClock}
          tone="amber"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Stock by location</CardTitle>
            <CardDescription>Where this product is right now.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Location</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perLocation.map(({ location, quantity }) => (
                    <TableRow key={location.id}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2">
                          <Warehouse className="size-4 text-muted-foreground" />
                          <span className="font-medium">{location.name}</span>
                          <Pill tone={location.type === "warehouse" ? "blue" : "gray"}>{location.type === "warehouse" ? "Warehouse" : "Shop"}</Pill>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(quantity)}</TableCell>
                      <TableCell>
                        <StockPill quantity={quantity} threshold={product.lowStockThreshold} />
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Button size="sm" variant="outline" onClick={() => setAdjust({ locationId: location.id, key: Date.now() })}>
                          Adjust
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>QR label</CardTitle>
            <CardDescription>Print and stick it on the shelf or item. Scanning it finds this product.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <div ref={qrRef} className="rounded-xl bg-white p-4">
              <QRCodeSVG value={code} size={160} marginSize={0} />
            </div>
            <code className="text-sm text-muted-foreground">{code}</code>
            <Button variant="outline" className="w-full" onClick={printLabel}>
              <Printer />
              Print label
            </Button>
          </CardContent>
        </Card>
      </div>

      {product.description && (
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-line text-muted-foreground">{product.description}</CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {showOrders && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="size-4" />
              Recent orders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {orders.data?.results.length === 0 && <p className="text-sm text-muted-foreground">No orders for this product yet.</p>}
            {orders.data?.results.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{s.client?.name ?? "Unknown client"}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.code} · {s.quantity} {product.unit} · {formatDate(s.createdAt)}
                  </div>
                </div>
                <ShipmentStatusPill status={s.status} />
              </div>
            ))}
          </CardContent>
        </Card>
        )}
        {showRentals && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4" />
              Recent rentals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rentals.data?.results.length === 0 && <p className="text-sm text-muted-foreground">No rentals for this product yet.</p>}
            {rentals.data?.results.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{r.client?.name ?? "Unknown client"}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.code} · {r.daysOut ?? r.days ?? "open"} days · {formatMoney(r.total)}
                  </div>
                </div>
                <RentalStatusPill status={r.status} overdue={isOverdue(r)} />
              </div>
            ))}
          </CardContent>
        </Card>
        )}
      </div>

      {selling && <SellDialog productId={id} onClose={() => setSelling(false)} />}
      {adjust && (
        <StockAdjustDialog
          key={adjust.key}
          productId={id}
          locationId={adjust.locationId}
          open
          onOpenChange={(open) => !open && setAdjust(null)}
        />
      )}
    </PageBody>
  )
}
