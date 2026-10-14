"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarClock, MoreHorizontal, Package, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  attempt,
  ConfirmAction,
  EmptyState,
  ListSkeleton,
  PageBody,
  PageHeader,
  Pager,
  Pill,
  QueryError,
  SearchInput,
  SimpleSelect,
} from "@/components/common"
import { usePermissions } from "@/components/session-provider"
import { StockPill } from "@/components/status"
import { actions } from "@/lib/data/actions"
import { PAGE_SIZE, useCategories, useDebounced, usePageNumber, useProducts, useStockSummary } from "@/lib/data/queries"
import { formatMoney, formatNumber } from "@/lib/format"
import type { Product } from "@/lib/types"

const STOCK_FILTERS = [
  { value: "all", label: "All stock levels" },
  { value: "in", label: "In stock" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out of stock" },
]

export function ProductsView() {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [stockFilter, setStockFilter] = useState("all")
  const [deleting, setDeleting] = useState<Product | null>(null)
  const search = useDebounced(query.trim())
  const [page, setPage] = usePageNumber(search, category, stockFilter)

  const categories = useCategories()
  const total = useStockSummary().data?.products
  const { data, error, isPending, isPlaceholderData, refetch } = useProducts({
    page,
    search,
    category: category === "all" ? undefined : category,
    stock: stockFilter === "all" ? undefined : stockFilter,
  })
  const rows = data?.results ?? []
  const filtered = !!search || category !== "all" || stockFilter !== "all"
  const canEdit = usePermissions().can("managerProducts")

  return (
    <PageBody>
      <PageHeader
        title="Products"
        description={total === undefined ? "Your catalogue" : `${formatNumber(total)} products in your catalogue`}
        actions={
          canEdit && (
            <Button render={<Link href="/products/new" />} nativeButton={false}>
              <Plus />
              Add product
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-2 md:flex-row">
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, SKU, barcode…" className="flex-1" />
        <SimpleSelect
          value={category}
          onChange={setCategory}
          options={[{ value: "all", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))]}
          className="h-9! md:w-48"
        />
        <SimpleSelect value={stockFilter} onChange={setStockFilter} options={STOCK_FILTERS} className="h-9! md:w-44" />
      </div>

      {error && !data ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title={filtered ? "No products match your filters" : "No products yet"}
          description={filtered ? "Try a different search or clear the filters." : "Add your first product, or scan its barcode from Quick Entry."}
          action={
            !filtered &&
            canEdit && (
              <Button render={<Link href="/products/new" />} nativeButton={false}>
                <Plus />
                Add product
              </Button>
            )
          }
        />
      ) : (
        <Card className={isPlaceholderData ? "py-0 opacity-60 transition-opacity" : "py-0"}>
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
                  const qty = p.total ?? 0
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
                            {canEdit && (
                              <>
                                <DropdownMenuItem onClick={() => router.push(`/products/${p.id}/edit`)}>
                                  <Pencil />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onClick={() => setDeleting(p)}>
                                  <Trash2 />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
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
      {data && <Pager page={data.page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} busy={isPlaceholderData} />}

      {deleting && (
        <DeleteProductDialog
          name={deleting.name}
          onClose={() => setDeleting(null)}
          onConfirm={() => attempt(() => actions.deleteProduct(deleting.id), "Product deleted")}
        />
      )}
    </PageBody>
  )
}

function DeleteProductDialog({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: () => Promise<boolean> }) {
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
