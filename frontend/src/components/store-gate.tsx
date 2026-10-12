"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { setCurrency } from "@/lib/format"
import { loadTenant } from "@/lib/store"
import type { Business, SessionUser } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/** Loads the business's data from the API before rendering data-driven pages. */
export function StoreGate({ user, business, children }: { user: SessionUser; business: Business; children: React.ReactNode }) {
  const [state, setState] = useState<{ key: string; error?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  // Reload when the user, business or its switches change (e.g. after saving settings).
  const key = `${user.id}:${business.id}:${JSON.stringify(business.settings)}:${attempt}`

  useEffect(() => {
    let cancelled = false
    setCurrency(business.settings.currency)
    loadTenant(user, business).then(
      () => !cancelled && setState({ key }),
      (err: unknown) => !cancelled && setState({ key, error: err instanceof Error ? err.message : "Couldn't load your data." }),
    )
    return () => {
      cancelled = true
    }
    // `key` covers every input that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (state?.key !== key) return <PageSkeleton />
  if (state.error) {
    return (
      <div className="flex min-h-[60svh] flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="size-8 text-amber-500" />
        <p className="font-medium">Couldn&apos;t load your data</p>
        <p className="max-w-sm text-sm text-muted-foreground">{state.error}</p>
        <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
          <RotateCcw />
          Try again
        </Button>
      </div>
    )
  }
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
