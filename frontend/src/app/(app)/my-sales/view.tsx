"use client"

import { useEffect, useState } from "react"
import { startOfDay, startOfMonth } from "date-fns"
import { CalendarDays, HandCoins, Package, Receipt, Sun } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, PageBody, PageHeader, Pill, StatCard } from "@/components/common"
import { useSessionUser } from "@/components/session-provider"
import { request } from "@/lib/api/client"
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format"
import { useLookups } from "@/lib/store/hooks"
import type { Sale } from "@/lib/types"
import { cn } from "@/lib/utils"
import { PaymentCell } from "../sales/view"

interface Totals {
  count: number
  revenue: number
  unitsSold: number
}

const CHANNEL_LABEL = { store: "In store", order: "Order", rental: "Rental" } as const

/** The logged-in person's own selling: today, this month, and every sale this month. Prices only. */
export function MySalesView() {
  const user = useSessionUser()
  const lookups = useLookups()
  const [data, setData] = useState<{ today: Totals; month: Totals; sales: Sale[] } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    const now = new Date()
    const since = (d: Date) => `mine=1&from=${encodeURIComponent(d.toISOString())}`
    Promise.all([
      request<Totals>(`sales/summary/?${since(startOfDay(now))}`),
      request<Totals>(`sales/summary/?${since(startOfMonth(now))}`),
      request<Sale[]>(`sales/?${since(startOfMonth(now))}`),
    ]).then(
      ([today, month, sales]) => !cancelled && setData({ today, month, sales }),
      (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Couldn't load your sales."),
    )
    return () => {
      cancelled = true
    }
  }, [])

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
            <StatCard label="Today" value={formatMoney(data.today.revenue)} hint={line(data.today)} icon={Sun} />
            <StatCard label="This month" value={formatMoney(data.month.revenue)} hint={line(data.month)} icon={CalendarDays} tone="green" />
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Shop</TableHead>
                    <TableHead className="pr-4">Type</TableHead>
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
                      <TableCell className="text-sm whitespace-nowrap">{(s.locationId && lookups.location.get(s.locationId)?.name) || "—"}</TableCell>
                      <TableCell className="pr-4 text-sm">{CHANNEL_LABEL[s.channel]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageBody>
  )
}
