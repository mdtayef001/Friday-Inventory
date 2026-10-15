"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { startOfDay, startOfMonth } from "date-fns"
import { CalendarDays, HandCoins, Package, Receipt, Sun } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, PageBody, PageHeader, Pager, Pill, StatCard, MoneyTotal } from "@/components/common"
import { useScope, useSessionUser } from "@/components/session-provider"
import { apiQuery, usePage, usePaging } from "@/lib/data/queries"
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format"
import type { Sale } from "@/lib/types"
import { cn } from "@/lib/utils"
import { PaymentCell, ReceiptLink } from "../sales/view"

interface Totals {
  count: number
  revenue: number
  unitsSold: number
}

const CHANNEL_LABEL = { store: "In store", order: "Order", rental: "Rental" } as const

/** The logged-in person's own selling: today, this month, and every sale this month. Prices only. */
export function MySalesView() {
  const user = useSessionUser()
  const { locations } = useScope()
  const paging = usePaging()
  // Worked out once per visit, so the queries keep the same keys.
  const since = useMemo(() => {
    const now = new Date()
    return { today: startOfDay(now).toISOString(), month: startOfMonth(now).toISOString() }
  }, [])
  const today = useQuery(apiQuery<Totals>("sales/summary/", { mine: true, from: since.today })).data
  const month = useQuery(apiQuery<Totals>("sales/summary/", { mine: true, from: since.month })).data
  const salesQuery = usePage<Sale>("sales/", { mine: true, from: since.month, page: paging.page }, { pageSize: paging.pageSize })
  const error = salesQuery.error?.message ?? ""
  const data = today && month && salesQuery.data ? { today, month, sales: salesQuery.data.results } : null
  const line = (t: Totals) => `${formatNumber(t.count)} sale${t.count === 1 ? "" : "s"} · ${formatNumber(t.unitsSold)} unit${t.unitsSold === 1 ? "" : "s"}`

  return (
    <PageBody>
      <PageHeader title="My Sales" description={`What you've sold, ${user.name.split(" ")[0]}.`} />
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {!data ? (
          <>
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </>
        ) : (
          <>
            <StatCard label="Today" value={<MoneyTotal value={data.today.revenue} />} hint={line(data.today)} icon={Sun} />
            <StatCard label="This month" value={<MoneyTotal value={data.month.revenue} />} hint={line(data.month)} icon={CalendarDays} tone="green" />
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-4" />
            This month
          </CardTitle>
          <CardDescription>Newest first. Refunded sales are greyed out and don&apos;t count.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {!data ? (
            <div className="space-y-2 px-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : data.sales.length === 0 ? (
            <EmptyState icon={HandCoins} title="No sales yet this month" description="Sales you make with Sell show up here straight away." />
          ) : (
            <div className="overflow-x-auto">
              <Table scroll>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Shop</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="pr-4">Receipt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sales.map((s) => (
                    <TableRow key={s.id} className={cn((s.refundedAt || s.paymentStatus !== "paid") && "text-muted-foreground opacity-60")}>
                      <TableCell className="pl-4 text-sm whitespace-nowrap">{formatDateTime(s.soldAt)}</TableCell>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <Package className="size-4 shrink-0 text-muted-foreground" />
                          {s.productName}
                        </span>
                        {s.refundedAt && <Pill tone="red">Refunded</Pill>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(s.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {formatMoney(s.unitPrice)}
                        {s.discount > 0 && <div className="text-xs text-muted-foreground">−{formatMoney(s.discount)}</div>}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">{formatMoney(s.revenue)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        <PaymentCell sale={s} />
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{(s.locationId && locations.find((l) => l.id === s.locationId)?.name) || "—"}</TableCell>
                      <TableCell className="text-sm">{CHANNEL_LABEL[s.channel]}</TableCell>
                      <TableCell className="pr-4">
                        <ReceiptLink sale={s} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {salesQuery.data && (
            <div className="px-4 pt-4">
              <Pager page={salesQuery.data.page} pageSize={paging.pageSize} count={salesQuery.data.count} onPage={paging.setPage} onPageSize={paging.setPageSize} busy={salesQuery.isPlaceholderData} />
            </div>
          )}
        </CardContent>
      </Card>
    </PageBody>
  )
}
