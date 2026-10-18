"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { PackagePlus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ListSkeleton, PageBody, PageHeader, Pager, QueryError, SearchInput, SimpleSelect } from "@/components/common"
import { PurchaseDialog } from "@/components/purchase-dialog"
import { useScope } from "@/components/session-provider"
import { SupplierPicker } from "@/components/supplier-dialog"
import { apiQuery, useDebounced, useLocations, usePaging, usePurchases, usePurchaseSummary } from "@/lib/data/queries"
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format"
import type { Purchase, Supplier, SupplierBrief } from "@/lib/types"

export function PurchasesView() {
  const params = useSearchParams()
  const { locations } = useScope()
  const allLocations = useLocations()
  const locationName = (id: string | null) => allLocations.find((l) => l.id === id)?.name ?? "Deleted location"

  const [query, setQuery] = useState("")
  const [locationId, setLocationId] = useState("")
  // Opened from the Suppliers page with ?supplier=<id>: load that supplier for the filter.
  const supplierParam = params.get("supplier")
  const linked = useQuery({ ...apiQuery<Supplier>(`suppliers/${supplierParam}/`), enabled: !!supplierParam }).data
  const [picked, setPicked] = useState<SupplierBrief | null | undefined>(undefined)
  const supplier = picked === undefined ? (linked ?? null) : picked
  const supplierId = picked === undefined ? (supplierParam ?? "") : (picked?.id ?? "")

  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<Purchase | null>(null)

  const search = useDebounced(query.trim())
  const filters = { search, supplier: supplierId, location: locationId }
  const paging = usePaging(search, supplierId, locationId)
  const { data, error, isPending, isPlaceholderData, refetch } = usePurchases({ page: paging.page, ...filters }, { pageSize: paging.pageSize })
  const summary = usePurchaseSummary(filters).data
  const rows = data?.results ?? []
  const filtered = !!(search || supplierId || locationId)

  return (
    <PageBody>
      <PageHeader
        title="Purchases"
        description="Stock you bought from suppliers. Each one puts the stock in and updates what the products cost you."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus />
            New purchase
          </Button>
        }
      />

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_12rem]">
        <SearchInput value={query} onChange={setQuery} placeholder="Search P-000012, bill number, supplier…" />
        <SupplierPicker value={supplier} onChange={setPicked} allowNone noneLabel="All suppliers" canAdd={false} />
        <SimpleSelect
          value={locationId || "all"}
          onChange={(v) => setLocationId(v === "all" ? "" : v)}
          options={[{ value: "all", label: "All locations" }, ...locations.map((l) => ({ value: l.id, label: l.name }))]}
        />
      </div>

      {summary && summary.count > 0 && (
        <Card size="sm">
          <CardContent className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
            <span>
              <span className="text-muted-foreground">Purchases</span> <span className="font-medium tabular-nums">{formatNumber(summary.count)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Total paid</span> <span className="font-medium tabular-nums">{formatMoney(summary.total)}</span>
            </span>
          </CardContent>
        </Card>
      )}

      {error && !data ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          title={filtered ? "No purchases match" : "No purchases yet"}
          description="When stock arrives from a supplier, record it here. The stock goes in and the product's cost is kept up to date."
          action={
            !filtered && (
              <Button onClick={() => setAdding(true)}>
                <Plus />
                New purchase
              </Button>
            )
          }
        />
      ) : (
        <Card className={isPlaceholderData ? "py-0 opacity-60 transition-opacity" : "py-0"}>
          <div className="overflow-x-auto">
            <Table scroll>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Date</TableHead>
                  <TableHead>Purchase</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Arrived at</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead className="pr-4 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => setOpen(p)}>
                    <TableCell className="pl-4 text-sm whitespace-nowrap">{formatDate(p.purchasedAt)}</TableCell>
                    <TableCell>
                      <button type="button" className="font-mono text-sm font-medium underline-offset-2 hover:underline">
                        {p.code}
                      </button>
                      {p.reference && <div className="text-xs text-muted-foreground">Bill {p.reference}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{p.supplier ? p.supplier.name : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm">{locationName(p.locationId)}</TableCell>
                    <TableCell className="max-w-72 text-sm">
                      <span className="line-clamp-2">{p.items.map((i) => `${i.quantity} × ${i.productName}`).join(", ")}</span>
                    </TableCell>
                    <TableCell className="pr-4 text-right font-medium tabular-nums">{formatMoney(p.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      {data && <Pager page={data.page} pageSize={paging.pageSize} count={data.count} onPage={paging.setPage} onPageSize={paging.setPageSize} busy={isPlaceholderData} />}

      {adding && <PurchaseDialog supplier={supplier} onClose={() => setAdding(false)} />}
      {open && <PurchaseDetail purchase={open} location={locationName(open.locationId)} onClose={() => setOpen(null)} />}
    </PageBody>
  )
}

function PurchaseDetail({ purchase: p, location, onClose }: { purchase: Purchase; location: string; onClose: () => void }) {
  const units = p.items.reduce((n, i) => n + i.quantity, 0)
  const facts: [string, string][] = [
    ["Supplier", p.supplier ? (p.supplier.company ? `${p.supplier.name} · ${p.supplier.company}` : p.supplier.name) : "None"],
    ["Arrived at", location],
    ["Bought on", formatDate(p.purchasedAt)],
    ["Supplier's bill", p.reference || "—"],
    ["Recorded by", `${p.createdBy || "—"} · ${formatDateTime(p.createdAt)}`],
  ]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">{p.code}</DialogTitle>
          <DialogDescription>
            {p.items.length} product{p.items.length === 1 ? "" : "s"} · {formatNumber(units)} units · {formatMoney(p.total)}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Paid each</TableHead>
                <TableHead className="pr-3 text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.items.map((i, n) => (
                <TableRow key={n}>
                  <TableCell className="pl-3">
                    {i.productName}
                    {!i.productId && <span className="block text-xs text-muted-foreground">Product deleted</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(i.quantity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(i.unitCost)}</TableCell>
                  <TableCell className="pr-3 text-right tabular-nums">{formatMoney(i.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="pl-3" colSpan={3}>
                  Total
                </TableCell>
                <TableCell className="pr-3 text-right tabular-nums">{formatMoney(p.total)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        {p.note && <p className="rounded-lg bg-muted/40 p-3 text-sm">{p.note}</p>}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
