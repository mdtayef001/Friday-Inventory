"use client"

import { request } from "@/lib/api/client"
import type { Client, Location, PaymentMethod, Product, Rental, Sale, Shipment, ShipmentStatus, StockRequest, Transfer } from "@/lib/types"
import { getQueryClient } from "./query-client"

// Every change goes to Django first; it does the stock maths, permission checks
// and activity log. Then the cached lists the change touched are refreshed:
// lists on screen refetch now, the rest when they're next shown. Actions reject
// with an Error carrying a readable message (e.g. not enough stock); callers
// show it as a toast.

type Collection = "locations" | "products" | "stock" | "clients" | "shipments" | "rentals" | "transfers" | "stock-requests" | "sales"

export type ProductInput = Omit<Product, "id" | "createdAt" | "createdBy" | "stock" | "total">

/** Every change can move the dashboard totals and adds to the activity log. */
async function refresh(...collections: Collection[]) {
  const client = getQueryClient()
  await Promise.all([...collections, "overview", "activity"].map((c) => client.invalidateQueries({ queryKey: [c] })))
}

async function call<T>(path: string, method: string, body: unknown, ...after: Collection[]) {
  const result = await request<T>(path, { method, body })
  await refresh(...after)
  return result
}

function positiveInt(n: number, label = "Quantity") {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a whole number above 0.`)
}

/** Optional text fields are sent as "" so clearing one in a form clears it in the database. */
function blanks<T extends object>(input: T, keys: string[]): T {
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) }
  for (const key of keys) if (key in out && out[key] === undefined) out[key] = ""
  return out as T
}

// Anything that moves stock changes products (their stock), the stock totals and the dashboard.
const STOCK: Collection[] = ["products", "stock"]

export const actions = {
  addProduct(input: ProductInput, initial: { locationId: string; quantity: number } | null) {
    const body = { ...input, initialLocationId: initial?.locationId ?? null, initialQuantity: initial?.quantity ?? 0 }
    return call<Product>("products/", "POST", body, ...STOCK)
  },
  async updateProduct(id: string, patch: Partial<ProductInput>) {
    await call(`products/${id}/`, "PATCH", blanks(patch, ["barcode", "description"]), "products")
  },
  async deleteProduct(id: string) {
    await call(`products/${id}/`, "DELETE", undefined, ...STOCK)
  },
  async adjustStock(productId: string, locationId: string, delta: number, reason: string) {
    if (!Number.isInteger(delta) || delta === 0) throw new Error("Enter a whole number that isn't 0.")
    await call("stock/adjust/", "POST", { productId, locationId, delta, reason }, ...STOCK)
  },

  addLocation(input: Omit<Location, "id">) {
    return call<Location>("locations/", "POST", input, "locations")
  },
  async updateLocation(id: string, patch: Partial<Omit<Location, "id">>) {
    await call(`locations/${id}/`, "PATCH", blanks(patch, ["phone", "address"]), "locations")
  },
  async deleteLocation(id: string) {
    await call(`locations/${id}/`, "DELETE", undefined, "locations", ...STOCK)
  },

  addClient(input: Omit<Client, "id" | "createdAt" | "stats">) {
    return call<Client>("clients/", "POST", input, "clients")
  },
  async updateClient(id: string, patch: Partial<Omit<Client, "id" | "createdAt" | "stats">>) {
    // Orders and rentals show the client's details too.
    await call(`clients/${id}/`, "PATCH", blanks(patch, ["company", "phone", "email", "address"]), "clients", "shipments", "rentals")
  },
  async deleteClient(id: string) {
    await call(`clients/${id}/`, "DELETE", undefined, "clients")
  },

  sell(input: {
    productId: string
    locationId: string
    quantity: number
    unitPrice: number
    discount: number
    clientId?: string
    paymentMethod: Sale["paymentMethod"]
    paymentReference?: string
  }) {
    positiveInt(input.quantity)
    return call<Sale>("sales/", "POST", input, ...STOCK, "sales", "clients")
  },
  /** The current state of an online payment, for the waiting screen. */
  async checkSale(id: string) {
    const sale = await request<Sale>(`sales/${id}/`)
    // Paid, or failed or expired and the stock went back.
    if (sale.paymentStatus !== "pending") await refresh(...STOCK, "sales", "clients")
    return sale
  },
  async cancelOnlinePayment(id: string) {
    await call(`sales/${id}/cancel-payment/`, "POST", {}, ...STOCK, "sales")
  },
  /** Owners and admins: the stock goes back, and online payments are refunded through SSLCommerz. Also approves a request. */
  returnSale(id: string, reason: string) {
    return call<Sale>(`sales/${id}/return/`, "POST", { reason }, ...STOCK, "sales")
  },
  /** Managers: ask the owner or an admin to take the sale back. */
  requestReturn(id: string, reason: string) {
    if (!reason.trim()) throw new Error("Say why the customer is returning it.")
    return call<Sale>(`sales/${id}/request-return/`, "POST", { reason }, "sales")
  },
  declineReturn(id: string, note: string) {
    return call<Sale>(`sales/${id}/decline-return/`, "POST", { note }, "sales")
  },

  createShipment(input: Pick<Shipment, "productId" | "quantity" | "clientId" | "fromLocationId" | "notes"> & { unitPrice?: number }) {
    positiveInt(input.quantity)
    return call<Shipment>("shipments/", "POST", input, "shipments", "clients", ...STOCK)
  },
  /** `paymentMethod` is how the client paid; only used when the order is marked delivered. */
  async setShipmentStatus(id: string, status: ShipmentStatus, note?: string, paymentMethod: PaymentMethod = "cash") {
    await call(`shipments/${id}/status/`, "POST", { status, note: note ?? "", paymentMethod }, "shipments", "clients", "sales", ...STOCK)
  },

  createRental(
    input: Pick<Rental, "productId" | "quantity" | "clientId" | "locationId" | "startDate" | "days" | "plan" | "rate" | "deposit" | "notes">,
  ) {
    positiveInt(input.quantity)
    if (input.days != null) positiveInt(input.days, "Expected days")
    return call<Rental>("rentals/", "POST", input, "rentals", "clients", ...STOCK)
  },
  async returnRental(id: string, holidays = 0, paymentMethod: PaymentMethod = "cash") {
    await call(`rentals/${id}/return/`, "POST", { holidays, paymentMethod }, "rentals", "clients", "sales", ...STOCK)
  },

  createTransfer(input: Pick<Transfer, "productId" | "quantity" | "fromLocationId" | "toLocationId">) {
    positiveInt(input.quantity)
    if (input.fromLocationId === input.toLocationId) throw new Error("Choose two different locations.")
    return call<Transfer>("transfers/", "POST", input, "transfers", ...STOCK)
  },
  async receiveTransfer(id: string) {
    await call(`transfers/${id}/receive/`, "POST", {}, "transfers", "stock-requests", ...STOCK)
  },
  async cancelTransfer(id: string) {
    await call(`transfers/${id}/cancel/`, "POST", {}, "transfers", "stock-requests", ...STOCK)
  },

  requestStock(input: { productId: string; quantity: number; toLocationId: string; note?: string }) {
    positiveInt(input.quantity)
    return call<StockRequest>("stock-requests/", "POST", input, "stock-requests")
  },
  async approveRequest(id: string, input: { fromLocationId: string; quantity: number }) {
    positiveInt(input.quantity)
    await call(`stock-requests/${id}/approve/`, "POST", input, "stock-requests", "transfers", ...STOCK)
  },
  async declineRequest(id: string, note?: string) {
    await call(`stock-requests/${id}/decline/`, "POST", { note: note ?? "" }, "stock-requests")
  },
  async cancelRequest(id: string) {
    await call(`stock-requests/${id}/cancel/`, "POST", {}, "stock-requests")
  },
}
