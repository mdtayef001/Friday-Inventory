"use client"

import { useEffect, useState } from "react"
import { setCurrency } from "@/lib/format"
import { loadTenant } from "@/lib/store"
import type { Business } from "@/lib/types"
import { DEMO_TENANT } from "@/lib/demo"
import { Skeleton } from "@/components/ui/skeleton"

/** Loads the business's saved data from localStorage before rendering data-driven pages. */
export function StoreGate({ business, children }: { business: Business; children: React.ReactNode }) {
  const [readyFor, setReadyFor] = useState<string | null>(null)
  const { id, settings } = business

  useEffect(() => {
    let cancelled = false
    setCurrency(settings.currency)
    void loadTenant({ id, demo: id === DEMO_TENANT }).then(() => {
      if (!cancelled) setReadyFor(`${id}:${settings.currency}`)
    })
    return () => {
      cancelled = true
    }
  }, [id, settings.currency])

  if (readyFor !== `${id}:${settings.currency}`) return <PageSkeleton />
  return children
}

export function PageSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}
