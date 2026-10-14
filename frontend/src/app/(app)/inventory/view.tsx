"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, Boxes, DollarSign, PackageX, Warehouse } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ListSkeleton, PageBody, PageHeader, Pager, QueryError, SearchInput, StatCard } from "@/components/common"
import { useScope } from "@/components/session-provider"
import { StockAdjustDialog } from "@/components/stock-adjust-dialog"
import { PAGE_SIZE, qtyAt, useDebounced, usePageNumber, useProducts, useStockSummary } from "@/lib/data/queries"
import { formatMoney, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

export function InventoryView() {
  const scope = useScope()
  const [query, setQuery] = useState("")
  const [lowOnly, setLowOnly] = useState(false)
  const [adjust, setAdjust] = useState<{ productId: string; locationId: string; key: number } | null>(null)
  const search = useDebounced(query.trim())
  const [page, setPage] = usePageNumber(search, lowOnly)
  const summary = useStockSummary().data
  const { data, error, isPending, isPlaceholderData, refetch } = useProducts({ page, search, attention: lowOnly })

  const rows = (data?.results ?? []).map((p) => {
    const cells = scope.locations.map((l) => qtyAt(p, l.id))
    return { product: p, cells, total: p.total ?? 0 }
  })

  return (
    <PageBody>
      <PageHeader
        title="Stock levels"
        description={
          scope.isOwner ? "How much of every product is in each warehouse and shop." : `Stock at ${scope.locations.map((l) => l.name).join(", ")}.`
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total units" value={summary ? formatNumber(summary.units) : "–"} icon={Boxes} />
        <StatCard label="Stock value (cost)" value={summary ? formatMoney(summary.value) : "–"} icon={DollarSign} tone="green" />
        <StatCard label="Low stock products" value={summary?.low ?? "–"} icon={AlertTriangle} tone="amber" />
        <StatCard label="Out of stock" value={summary?.out ?? "–"} icon={PackageX} tone="red" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={query} onChange={setQuery} placeholder="Search products…" className="flex-1" />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={lowOnly} onCheckedChange={setLowOnly} />
          Only show low or empty
        </label>
      </div>

      {scope.locations.length === 0 ? (
        <EmptyState icon={Warehouse} title="No locations assigned" description="Ask the owner to assign you to a warehouse or shop." />
      ) : error && !data ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <ListSkeleton />
      ) : (
        <Card className={isPlaceholderData ? "py-0 opacity-60 transition-opacity" : "py-0"}>
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
                {rows.map(({ product, cells, total }) => (
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
                {rows.length === 0 && (
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
      {data && <Pager page={data.page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} busy={isPlaceholderData} />}
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
