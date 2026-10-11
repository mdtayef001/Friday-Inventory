"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, Boxes, DollarSign, PackageX, Search, Warehouse } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, PageBody, PageHeader, StatCard } from "@/components/common"
import { useScope } from "@/components/session-provider"
import { StockAdjustDialog } from "@/components/stock-adjust-dialog"
import { formatMoney, formatNumber } from "@/lib/format"
import { qtyAt, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

export function InventoryView() {
  const scope = useScope()
  const products = useStore((s) => s.products)
  const stock = useStore((s) => s.stock)
  const [query, setQuery] = useState("")
  const [lowOnly, setLowOnly] = useState(false)
  const [adjust, setAdjust] = useState<{ productId: string; locationId: string; key: number } | null>(null)

  const rows = useMemo(
    () =>
      products.map((p) => {
        const cells = scope.locations.map((l) => qtyAt(stock, p.id, l.id))
        return { product: p, cells, total: cells.reduce((a, b) => a + b, 0) }
      }),
    [products, stock, scope.locations],
  )

  const totals = useMemo(() => {
    let units = 0
    let value = 0
    let low = 0
    let out = 0
    for (const r of rows) {
      units += r.total
      value += r.total * r.product.cost
      if (r.total === 0) out++
      else if (r.total <= r.product.lowStockThreshold) low++
    }
    return { units, value, low, out }
  }, [rows])

  const q = query.trim().toLowerCase()
  const visible = rows.filter(
    (r) =>
      (!q || [r.product.name, r.product.sku, r.product.category].some((v) => v.toLowerCase().includes(q))) &&
      (!lowOnly || r.cells.some((c) => c <= r.product.lowStockThreshold)),
  )

  return (
    <PageBody>
      <PageHeader
        title="Stock levels"
        description={
          scope.isAdmin ? "How much of every product is in each warehouse and shop." : `Stock at ${scope.locations.map((l) => l.name).join(", ")}.`
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total units" value={formatNumber(totals.units)} icon={Boxes} />
        <StatCard label="Stock value (cost)" value={formatMoney(totals.value)} icon={DollarSign} tone="green" />
        <StatCard label="Low stock products" value={totals.low} icon={AlertTriangle} tone="amber" />
        <StatCard label="Out of stock" value={totals.out} icon={PackageX} tone="red" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products…" className="h-9 pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={lowOnly} onCheckedChange={setLowOnly} />
          Only show low or empty
        </label>
      </div>

      {scope.locations.length === 0 ? (
        <EmptyState icon={Warehouse} title="No locations assigned" description="Ask an admin to assign you to a warehouse or shop." />
      ) : (
        <Card className="py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 min-w-48 bg-card pl-4">Product</TableHead>
                  {scope.locations.map((l) => (
                    <TableHead key={l.id} className="min-w-28 text-right">
                      <Link href={`/locations/${l.id}`} className="hover:underline">
                        {l.name}
                      </Link>
                    </TableHead>
                  ))}
                  <TableHead className="pr-4 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(({ product, cells, total }) => (
                  <TableRow key={product.id}>
                    <TableCell className="sticky left-0 z-10 bg-card pl-4">
                      <Link href={`/products/${product.id}`} className="font-medium hover:underline">
                        {product.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{product.sku}</div>
                    </TableCell>
                    {cells.map((qty, i) => {
                      const location = scope.locations[i]
                      return (
                        <TableCell key={location.id} className="text-right">
                          <button
                            type="button"
                            title={`Adjust stock at ${location.name}`}
                            onClick={() => setAdjust({ productId: product.id, locationId: location.id, key: Date.now() })}
                            className={cn(
                              "min-w-12 rounded-md px-2 py-1 tabular-nums transition-colors hover:bg-muted",
                              qty === 0 && "text-muted-foreground/60",
                              qty > 0 && qty <= product.lowStockThreshold && "bg-amber-500/10 font-medium text-amber-700 dark:text-amber-300",
                            )}
                          >
                            {qty === 0 ? "–" : formatNumber(qty)}
                          </button>
                        </TableCell>
                      )
                    })}
                    <TableCell className="pr-4 text-right font-semibold tabular-nums">{formatNumber(total)}</TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={scope.locations.length + 2} className="py-10 text-center text-muted-foreground">
                      No products match.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Tip: click any number to add or remove stock at that location.</p>

      {adjust && (
        <StockAdjustDialog
          key={adjust.key}
          productId={adjust.productId}
          locationId={adjust.locationId}
          open
          onOpenChange={(open) => !open && setAdjust(null)}
        />
      )}
    </PageBody>
  )
}
