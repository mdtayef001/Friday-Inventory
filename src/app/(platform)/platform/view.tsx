"use client"

import Link from "next/link"
import { ArrowRight, Building2, CircleDollarSign, Clock, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageBody, PageHeader, StatCard } from "@/components/common"
import { BusinessStatusPill, STATUS } from "@/components/platform"
import { formatNumber, timeAgo } from "@/lib/format"
import { PRICE_LABEL, SUBSCRIPTION, formatTaka } from "@/lib/business"
import type { BusinessStatus, BusinessSummary } from "@/lib/types"

const ORDER: BusinessStatus[] = ["active", "trial", "suspended"]

export function PlatformOverview({ businesses }: { businesses: BusinessSummary[] }) {
  const paying = businesses.filter((b) => b.status === "active")
  const mrr = paying.length * SUBSCRIPTION.price
  const trials = businesses.filter((b) => b.status === "trial").length
  const suspended = businesses.filter((b) => b.status === "suspended").length
  const users = businesses.reduce((sum, b) => sum + b.userCount, 0)

  return (
    <PageBody>
      <PageHeader
        title="Platform overview"
        description="You run the platform. Each business is managed by its own owner."
        actions={
          <Button render={<Link href="/platform/businesses?new=1" />} nativeButton={false}>
            <Building2 />
            Add business
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Businesses" value={businesses.length} hint={`${suspended} suspended`} icon={Building2} />
        <StatCard label="Monthly revenue" value={formatTaka(mrr)} hint={`${paying.length} paying × ${PRICE_LABEL}`} icon={CircleDollarSign} tone="green" />
        <StatCard label="On free trial" value={trials} icon={Clock} tone="amber" />
        <StatCard label="Users" value={formatNumber(users)} hint="Across all businesses" icon={Users} tone="violet" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Subscriptions</CardTitle>
            <CardDescription>{PRICE_LABEL} per business</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {ORDER.map((status) => {
              const count = businesses.filter((b) => b.status === status).length
              return (
                <div key={status} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{status === "active" ? "Paying" : STATUS[status].label}</span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${businesses.length ? (count / businesses.length) * 100 : 0}%` }} />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Newest businesses</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" render={<Link href="/platform/businesses" />} nativeButton={false}>
                All
                <ArrowRight />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-1">
            {businesses.slice(0, 6).map((b) => (
              <Link
                key={b.id}
                href={`/platform/businesses/${b.id}`}
                className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted/60"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{b.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {b.owner?.name ?? "No owner"} · joined {timeAgo(b.createdAt)}
                  </span>
                </span>
                <BusinessStatusPill status={b.status} />
              </Link>
            ))}
            {businesses.length === 0 && <p className="text-sm text-muted-foreground">No businesses yet.</p>}
          </CardContent>
        </Card>
      </div>
    </PageBody>
  )
}
