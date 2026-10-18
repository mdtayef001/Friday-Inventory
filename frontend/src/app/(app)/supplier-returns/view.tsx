"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Ban, Banknote, MoreHorizontal, PackageCheck, PackageX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ListSkeleton, PageBody, PageHeader, Pager, QueryError, SearchInput, SimpleSelect } from "@/components/common"
import { useSessionUser } from "@/components/session-provider"
import { SupplierPicker } from "@/components/supplier-dialog"
import { REFUND_METHODS, ReturnStatusPill, SettleReturnDialog, type SettleMode } from "@/components/supplier-return"
import { useDebounced, usePaging, useSupplierReturns, useSupplierReturnSummary } from "@/lib/data/queries"
import { formatDate, formatMoney, formatNumber } from "@/lib/format"
import type { SupplierBrief, SupplierReturn } from "@/lib/types"

const STATUSES = [
  { value: "open", label: "Waiting for supplier" },
  { value: "settled", label: "Settled" },
  { value: "closed", label: "Closed unsettled" },
  { value: "all", label: "All returns" },
]

export function SupplierReturnsView() {
  const params = useSearchParams()
  // Opened from a purchase with ?purchase=<id>: every return of that purchase.
  const purchase = params.get("purchase") ?? ""
  const [status, setStatus] = useState(purchase ? "all" : "open")
  const [query, setQuery] = useState("")
  const [supplier, setSupplier] = useState<SupplierBrief | null>(null)
  const [settling, setSettling] = useState<{ ret: SupplierReturn; mode: SettleMode } | null>(null)

  const search = useDebounced(query.trim())
  const filters = { search, status: status === "all" ? "" : status, supplier: supplier?.id ?? "", purchase }
  const paging = usePaging(search, status, supplier?.id, purchase)
  const { data, error, isPending, isPlaceholderData, refetch } = useSupplierReturns({ page: paging.page, ...filters }, { pageSize: paging.pageSize })
  const summary = useSupplierReturnSummary().data
  const rows = data?.results ?? []

  return (
    <PageBody>
      <PageHeader
        title="Returns to Suppliers"
        description="Broken or wrong stock sent back. Each one waits until the supplier sends new units or gives the money back."
      />

      {summary && (
        <Card size="sm">
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-1 text-sm">
            {summary.openCount ? (
              <>
                <span>
                  <span className="text-muted-foreground">Waiting for suppliers</span>{" "}
                  <span className="font-medium tabular-nums">{formatNumber(summary.openCount)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">Suppliers owe you</span>{" "}
                  <span className="font-medium tabular-nums text-amber-700 dark:text-amber-400">{formatMoney(summary.owed)}</span>
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Nothing waiting. Every return has been settled.</span>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_13rem]">
        <SearchInput value={query} onChange={setQuery} placeholder="Search SR-000003, product, supplier, reason…" />
        <SupplierPicker value={supplier} onChange={setSupplier} allowNone noneLabel="All suppliers" canAdd={false} />
        <SimpleSelect value={status} onChange={setStatus} options={STATUSES} />
      </div>
      {purchase && (
        <p className="text-sm text-muted-foreground">
          Showing the returns of one purchase.{" "}
          <Link href="/supplier-returns" className="underline underline-offset-2">
            Show all
          </Link>
        </p>
      )}

      {error && !data ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PackageX}
          title={status === "open" && !search && !supplier ? "Nothing waiting on suppliers" : "No returns match"}
          description="To send broken or wrong stock back, open the purchase it came on and use Return next to the product."
          action={
            <Button variant="outline" render={<Link href="/purchases" />} nativeButton={false}>
              Go to Purchases
            </Button>
          }
        />
      ) : (
        <Card className={isPlaceholderData ? "py-0 opacity-60 transition-opacity" : "py-0"}>
          <div className="overflow-x-auto">
            <Table scroll>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Date</TableHead>
                  <TableHead>Return</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Settled so far</TableHead>
                  <TableHead className="text-right">Still owed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="sticky right-0 z-10 w-10 bg-card pr-4 shadow-[-1px_0_0_var(--border)]">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4 text-sm whitespace-nowrap">{formatDate(r.createdAt)}</TableCell>
                    <TableCell>
                      <div className="font-mono text-sm font-medium">{r.code}</div>
                      <div className="text-xs text-muted-foreground">from {r.purchaseCode}</div>
                    </TableCell>
                    <TableCell className="text-sm">{r.supplier ? r.supplier.name : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="max-w-64 text-sm">
                      <div className="font-medium">
                        {r.quantity} × {r.productName}
                      </div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">{r.reason}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.value)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.replacedQuantity > 0 && <div>{r.replacedQuantity} replaced</div>}
                      {r.refundedAmount > 0 && (
                        <div>
                          {formatMoney(r.refundedAmount)} refunded{r.refundMethod ? ` (${REFUND_METHODS[r.refundMethod].toLowerCase()})` : ""}
                        </div>
                      )}
                      {!r.replacedQuantity && !r.refundedAmount && <span className="text-muted-foreground">Nothing yet</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {r.status === "open" ? formatMoney(r.outstanding) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <ReturnStatusPill status={r.status} />
                      {r.closedNote && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{r.closedNote}</div>}
                    </TableCell>
                    <TableCell className="sticky right-0 z-10 bg-card pr-4 shadow-[-1px_0_0_var(--border)]">
                      {r.status === "open" && <ReturnActions ret={r} onSettle={(mode) => setSettling({ ret: r, mode })} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      {data && <Pager page={data.page} pageSize={paging.pageSize} count={data.count} onPage={paging.setPage} onPageSize={paging.setPageSize} busy={isPlaceholderData} />}

      {settling && <SettleReturnDialog ret={settling.ret} mode={settling.mode} onClose={() => setSettling(null)} />}
    </PageBody>
  )
}

function ReturnActions({ ret: r, onSettle }: { ret: SupplierReturn; onSettle: (mode: SettleMode) => void }) {
  const { role } = useSessionUser()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Return actions" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {r.unitsToReplace > 0 && r.productId && (
          <DropdownMenuItem onClick={() => onSettle("replacement")}>
            <PackageCheck />
            Replacement received…
          </DropdownMenuItem>
        )}
        {r.outstanding > 0 && (
          <DropdownMenuItem onClick={() => onSettle("refund")}>
            <Banknote />
            Refund received…
          </DropdownMenuItem>
        )}
        {role === "owner" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onSettle("close")} className="text-destructive">
              <Ban />
              Close without settling…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
