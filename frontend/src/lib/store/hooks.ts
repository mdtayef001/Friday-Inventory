"use client"

import { useMemo } from "react"
import { useScope } from "@/components/session-provider"
import { useStore } from "./index"

/** Quantity of each product across the locations the current user can see. */
export function useScopedTotals() {
  const stock = useStore((s) => s.stock)
  const scope = useScope()
  return useMemo(() => {
    const totals = new Map<string, number>()
    for (const row of stock) {
      if (!scope.has(row.locationId)) continue
      totals.set(row.productId, (totals.get(row.productId) ?? 0) + row.quantity)
    }
    return totals
  }, [stock, scope])
}

/** Lookup maps so tables can show names instead of ids. */
export function useLookups() {
  const products = useStore((s) => s.products)
  const clients = useStore((s) => s.clients)
  const locations = useStore((s) => s.locations)
  return useMemo(
    () => ({
      product: new Map(products.map((p) => [p.id, p])),
      client: new Map(clients.map((c) => [c.id, c])),
      location: new Map(locations.map((l) => [l.id, l])),
    }),
    [products, clients, locations],
  )
}
