"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query"
import { request } from "@/lib/api/client"
import type {
  Activity,
  Badges,
  Client,
  Location,
  Overview,
  Page,
  Product,
  Purchase,
  Rental,
  RentalSummary,
  Shipment,
  ShipmentCounts,
  StockRequest,
  StockSummary,
  Supplier,
  SupplierPayment,
  SupplierReturn,
  SupplierStatement,
  Transfer,
} from "@/lib/types"

// Reads from the Django API, cached by TanStack Query. Lists come a page at a
// time and are searched and filtered by the server, so a business with
// thousands of products or clients loads as fast as one with ten.

export type Params = Record<string, string | number | boolean | string[] | null | undefined>

/** "products/" and { search: "tv", inStock: true } -> "products/?search=tv&in_stock=1". Empty values are left out. */
export function withParams(path: string, params: Params = {}) {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue
    const key = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v === true ? "1" : String(v))
  }
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

/**
 * Keys start with the API collection ("products", "rentals", …), so a change can
 * refresh everything cached from that collection at once (see actions.ts).
 */
export function apiQuery<T>(path: string, params: Params = {}) {
  return queryOptions({
    queryKey: [path.split("/")[0], path, params] as const,
    queryFn: ({ signal }) => request<T>(withParams(path, params), { signal }),
  })
}

/** Rows per page people can choose. The first is the default. */
export const PAGE_SIZES = [10, 50, 100]
const PAGE_SIZE_KEY = "friday.pageSize"

/** One page of a list. The previous page stays on screen while the next one loads. */
export function usePage<T>(path: string, params: Params & { page: number }, { pageSize = PAGE_SIZES[0], enabled = true } = {}) {
  return useQuery({ ...apiQuery<Page<T>>(path, { ...params, pageSize }), placeholderData: keepPreviousData, enabled })
}

/** Remembers the page, and goes back to page 1 whenever the filters change. */
export function usePageNumber(...filters: unknown[]) {
  const key = JSON.stringify(filters)
  const [state, setState] = useState({ key, page: 1 })
  const page = state.key === key ? state.page : 1
  return [page, (next: number) => setState({ key, page: next })] as const
}

/**
 * Page number and rows per page for a list. Back to page 1 when the filters or the
 * page size change. The chosen size is remembered in this browser for every list.
 */
export function usePaging(...filters: unknown[]) {
  const [pageSize, setSize] = useState(savedPageSize)
  const [page, setPage] = usePageNumber(pageSize, ...filters)
  function setPageSize(size: number) {
    setSize(size)
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size))
    } catch {
      // Private window or storage blocked: it just isn't remembered.
    }
  }
  return { page, pageSize, setPage, setPageSize }
}

function savedPageSize() {
  try {
    const size = Number(localStorage.getItem(PAGE_SIZE_KEY))
    return PAGE_SIZES.includes(size) ? size : PAGE_SIZES[0]
  } catch {
    return PAGE_SIZES[0]
  }
}

/** The value after it stopped changing for a moment, so typing doesn't send a request per key. */
export function useDebounced<T>(value: T, ms = 300) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/**
 * A list's search box, filled from ?q= so the main search can link to a match. Follows ?q
 * when it changes, so picking another match while already on the page still shows it.
 */
export function useLinkedSearch(onLink?: (q: string) => void) {
  const linked = useSearchParams().get("q") ?? ""
  const [query, setQuery] = useState(linked)
  const [seen, setSeen] = useState(linked)
  if (linked !== seen) {
    setSeen(linked)
    setQuery(linked)
    onLink?.(linked)
  }
  return [query, setQuery] as const
}

// ---------- Small lists ----------

/** Every location in the business. Few, and needed everywhere; <StoreGate> loads them first. */
export const locationsQuery = { ...apiQuery<Location[]>("locations/"), staleTime: 5 * 60_000 }

export function useLocations() {
  return useQuery(locationsQuery).data ?? EMPTY
}
const EMPTY: Location[] = []

export function useCategories() {
  return useQuery({ ...apiQuery<string[]>("products/categories/"), staleTime: 5 * 60_000 }).data ?? []
}

export function useActivityPeople(enabled = true) {
  return useQuery({ ...apiQuery<{ id: string; name: string }[]>("activity/people/"), enabled }).data ?? []
}

// ---------- Single records ----------

export function useProduct(id: string | null | undefined) {
  return useQuery({ ...apiQuery<Product>(`products/${id}/`), enabled: !!id })
}

export function useShipment(id: string | null, placeholder?: Shipment) {
  return useQuery({ ...apiQuery<Shipment>(`shipments/${id}/`), enabled: !!id, placeholderData: placeholder })
}

/** Stock of a product at a location, from a product loaded with its stock. */
export function qtyAt(product: Pick<Product, "stock"> | null | undefined, locationId: string | null | undefined) {
  return (locationId && product?.stock?.[locationId]) || 0
}

// ---------- Totals ----------

export function useOverview() {
  return useQuery(apiQuery<Overview>("overview/"))
}

/** The sidebar's counts. Rechecked every minute, since other people's changes affect them too. */
export function useBadges() {
  return useQuery({ ...apiQuery<Badges>("overview/", { only: "badges" }), refetchInterval: 60_000 }).data
}

export function useStockSummary() {
  return useQuery(apiQuery<StockSummary>("stock/summary/"))
}

export function useRentalSummary(params: { product?: string; location?: string } = {}, enabled = true) {
  return useQuery({ ...apiQuery<RentalSummary>("rentals/summary/", params), enabled })
}

export function useShipmentCounts(params: { location?: string } = {}, enabled = true) {
  return useQuery({ ...apiQuery<ShipmentCounts>("shipments/counts/", params), enabled })
}

// Typed shortcuts for the lists, so pages read clearly.
export const useProducts = (params: Params & { page: number }, options?: { pageSize?: number; enabled?: boolean }) =>
  usePage<Product>("products/", params, options)
export const useClients = (params: Params & { page: number }, options?: { pageSize?: number; enabled?: boolean }) =>
  usePage<Client>("clients/", params, options)
export const useShipments = (params: Params & { page: number }, options?: { pageSize?: number; enabled?: boolean }) =>
  usePage<Shipment>("shipments/", params, options)
export const useRentals = (params: Params & { page: number }, options?: { pageSize?: number; enabled?: boolean }) =>
  usePage<Rental>("rentals/", params, options)
export const useTransfers = (params: Params & { page: number }, options?: { pageSize?: number; enabled?: boolean }) =>
  usePage<Transfer>("transfers/", params, options)
export const useStockRequests = (params: Params & { page: number }, options?: { pageSize?: number; enabled?: boolean }) =>
  usePage<StockRequest>("stock-requests/", params, options)
export const useSuppliers = (params: Params & { page: number }, options?: { pageSize?: number; enabled?: boolean }) =>
  usePage<Supplier>("suppliers/", params, options)
export const usePurchases = (params: Params & { page: number }, options?: { pageSize?: number; enabled?: boolean }) =>
  usePage<Purchase>("purchases/", params, options)

export const useSupplierReturns = (params: Params & { page: number }, options?: { pageSize?: number; enabled?: boolean }) =>
  usePage<SupplierReturn>("supplier-returns/", params, options)

/** Returns still waiting on suppliers, and what they owe back in total. */
export function useSupplierReturnSummary(enabled = true) {
  return useQuery({ ...apiQuery<{ openCount: number; owed: number }>("supplier-returns/summary/"), enabled })
}

/** How many purchases match the filters, their total, and how much of it is still owed. */
export function usePurchaseSummary(params: Params = {}) {
  return useQuery({ ...apiQuery<{ count: number; total: number; due: number }>("purchases/summary/", params), placeholderData: keepPreviousData })
}

export const useSupplierPayments = (params: Params & { page: number }, options?: { pageSize?: number; enabled?: boolean }) =>
  usePage<SupplierPayment>("supplier-payments/", params, options)

/** Owners and admins: what's owed to all suppliers, how much is overdue, and to how many. */
export function useSupplierPaymentSummary(enabled = true) {
  return useQuery({ ...apiQuery<{ owed: number; overdue: number; supplierCount: number }>("supplier-payments/summary/"), enabled })
}

export function useSupplier(id: string) {
  return useQuery(apiQuery<Supplier>(`suppliers/${id}/`, { stats: true }))
}

/** Owners and admins: every bill and payment with the supplier, newest first, with the balance after each. */
export function useSupplierStatement(id: string, enabled = true) {
  // Keyed under "supplier-payments" too, so a purchase, payment or return credit refreshes it.
  return useQuery({
    queryKey: ["supplier-payments", "statement", id],
    queryFn: ({ signal }) => request<SupplierStatement>(`suppliers/${id}/statement/`, { signal }),
    enabled,
  })
}

export const useActivity = (params: Params & { page: number }, options?: { pageSize?: number; enabled?: boolean }) =>
  usePage<Activity>("activity/", params, options)
