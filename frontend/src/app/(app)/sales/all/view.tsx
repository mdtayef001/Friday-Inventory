"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Receipt, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, PageBody, PageHeader, Pager, QueryError, SearchInput } from "@/components/common"
import { ReturnRequests } from "@/components/sale-return"
import { useDebounced, usePage, usePaging } from "@/lib/data/queries"
import { formatNumber } from "@/lib/format"
import type { Sale } from "@/lib/types"
import { cn } from "@/lib/utils"
import { SalesTable } from "../view"

/** Every sale, newest first, in pages. Search finds one by its receipt number. */
export function AllSalesView() {
  const [query, setQuery] = useState("")
  const search = useDebounced(query.trim())
  const paging = usePaging(search)
  const salesQuery = usePage<Sale>("sales/", { search: search || undefined, page: paging.page }, { pageSize: paging.pageSize })
  const list = salesQuery.data
  const sales = list?.results ?? []

  return (
    <PageBody>
      <PageHeader
        title="All sales"
        description="Every sale, newest first. Search by the receipt number on the customer's receipt."
        actions={
          <Button variant="outline" render={<Link href="/sales" />} nativeButton={false}>
            <ArrowLeft />
            Sales overview
          </Button>
        }
      />

      <ReturnRequests />

      <Card className={cn(salesQuery.isPlaceholderData && "opacity-60 transition-opacity")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-4" />
            Sales
          </CardTitle>
          <CardDescription>
            {list ? `${formatNumber(list.count)} sale${list.count === 1 ? "" : "s"}${search ? ` matching “${search}”` : ""}. ` : ""}Refunded sales are greyed out and not
            counted. Use ⋯ on a shop sale to return it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          <div className="px-4">
            <SearchInput className="max-w-xs" value={query} onChange={setQuery} placeholder="Receipt no, e.g. R-000706" />
          </div>
          {salesQuery.error ? (
            <div className="px-4">
              <QueryError error={salesQuery.error} onRetry={() => salesQuery.refetch()} />
            </div>
          ) : !list ? (
            <div className="space-y-2 px-4">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : sales.length === 0 ? (
            search ? (
              <EmptyState icon={Receipt} title="No sale with that receipt number" description="Check the number on the receipt, e.g. R-000706 or just 706." />
            ) : (
              <EmptyState icon={ShoppingCart} title="No sales yet" description="Sales from Sell, delivered orders and returned rentals show up here." />
            )
          ) : (
            <SalesTable sales={sales} />
          )}
          {list && list.count > 0 && (
            <div className="px-4">
              <Pager page={list.page} pageSize={paging.pageSize} count={list.count} onPage={paging.setPage} onPageSize={paging.setPageSize} busy={salesQuery.isPlaceholderData} />
            </div>
          )}
        </CardContent>
      </Card>
    </PageBody>
  )
}
