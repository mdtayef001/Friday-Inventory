"use client"

import { useEffect, useState } from "react"
import { useStore } from "@/lib/store"
import { Skeleton } from "@/components/ui/skeleton"

/** Loads saved data from localStorage before rendering data-driven pages. */
export function StoreGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const done = () => setReady(true)
    const unsub = useStore.persist.onFinishHydration(done)
    if (useStore.persist.hasHydrated()) done()
    else void useStore.persist.rehydrate()
    return unsub
  }, [])

  if (!ready) return <PageSkeleton />
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
