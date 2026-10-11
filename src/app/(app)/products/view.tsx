"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarClock, MoreHorizontal, Package, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { attempt, ConfirmAction, EmptyState, PageBody, PageHeader, Pill, SimpleSelect } from "@/components/common"
import { useSessionUser } from "@/components/session-provider"
import { StockPill } from "@/components/status"
import { formatMoney, formatNumber } from "@/lib/format"
import { useStore } from "@/lib/store"
import { useScopedTotals } from "@/lib/store/hooks"

const STOCK_FILTERS = [
  { value: "all", label: "All stock levels" },
  { value: "in", label: "In stock" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out of stock" },
]

export function ProductsView() {
  const router = useRouter()
  const user = useSessionUser()
  const products = useStore((s) => s.products)
  const deleteProduct = useStore((s) => s.deleteProduct)
  const totals = useScopedTotals()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [stockFilter, setStockFilter] = useState("all")
  const [deleting, setDeleting] = useState<string | null>(null)

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => {
      const qty = totals.get(p.id) ?? 0
      if (q && ![p.name, p.sku, p.barcode ?? "", p.category].some((v) => v.toLowerCase().includes(q))) return false
      if (category !== "all" && p.category !== category) return false
      if (stockFilter === "out" && qty > 0) return false
      if (stockFilter === "low" && (qty === 0 || qty > p.lowStockThreshold)) return false
      if (stockFilter === "in" && qty <= p.lowStockThreshold) return false
      return true
    })
  }, [products, totals, query, category, stockFilter])

  const toDelete = products.find((p) => p.id === deleting)

  return (
    <PageBody>
      <PageHeader
        title="Products"
        description={`${products.length} products in your catalogue`}
        actions={
          <Button render={<Link href="/products/new" />} nativeButton={false}>
            <Plus />
            Add product
          </Button>
        }
      />

      <div className="flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, SKU, barcode…" className="h-9 pl-9" />
        </div>
        <SimpleSelect
          value={category}
          onChange={setCategory}
          options={[{ value: "all", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))]}
          className="h-9! md:w-48"
        />
        <SimpleSelect value={stockFilter} onChange={setStockFilter} options={STOCK_FILTERS} className="h-9! md:w-44" />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title={products.length === 0 ? "No products yet" : "No products match your filters"}
          description={products.length === 0 ? "Add your first product, or scan its barcode from Quick Entry." : "Try a different search or clear the filters."}
          action={
            products.length === 0 && (
              <Button render={<Link href="/products/new" />} nativeButton={false}>
                <Plus />
                Add product
              </Button>
            )
          }
        />
      ) : (
        <Card className="py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const qty = totals.get(p.id) ?? 0
                  return (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/products/${p.id}`)}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <Package className="size-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 font-medium">
                              <span className="truncate">{p.name}</span>
                              {p.rentable && (
                                <Pill tone="violet">
                                  <CalendarClock className="size-3" />
                                  Rent
                                </Pill>
                              )}
                            </div>
                            <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.category}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(qty)} <span className="text-xs text-muted-foreground">{p.unit}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(p.price)}</TableCell>
                      <TableCell>
                        <StockPill quantity={qty} threshold={p.lowStockThreshold} />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}>
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={() => router.push(`/products/${p.id}`)}>
                              <Package />
                              View details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => router.push(`/products/${p.id}/edit`)}>
                              <Pencil />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(p.id)}>
                              <Trash2 />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {toDelete && (
        <DeleteProductDialog
          name={toDelete.name}
          onClose={() => setDeleting(null)}
          onConfirm={() => attempt(() => deleteProduct(toDelete.id, user.name), "Product deleted")}
        />
      )}
    </PageBody>
  )
}

function DeleteProductDialog({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: () => boolean }) {
  // Opened from a menu item, so render the confirm dialog open and close it on finish.
  return (
    <ConfirmAction
      defaultOpen
      onOpenChange={(open) => !open && onClose()}
      title={`Delete ${name}?`}
      description="This removes the product and all of its stock records. This can't be undone."
      confirmLabel="Delete"
      destructive
      onConfirm={onConfirm}
    />
  )
}
