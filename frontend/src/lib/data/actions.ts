"use client"

import { request } from "@/lib/api/client"
import type {
  Client,
  Location,
  PaymentMethod,
  Product,
  Purchase,
  RefundMethod,
  Rental,
  Sale,
  Shipment,
  ShipmentStatus,
  StockRequest,
  Supplier,
  SupplierPayment,
  SupplierReturn,
  Transfer,
} from "@/lib/types"
import { getQueryClient } from "./query-client"

// Every change goes to Django first; it does the stock maths, permission checks
// and activity log. Then the cached lists the change touched are refreshed:
// lists on screen refetch now, the rest when they're next shown. Actions reject
// with an Error carrying a readable message (e.g. not enough stock); callers
// show it as a toast.

type Collection =
  | "locations"
  | "products"
  | "stock"
  | "clients"
  | "shipments"
  | "rentals"
  | "transfers"
  | "stock-requests"
  | "sales"
  | "suppliers"
  | "purchases"
  | "supplier-returns"
  | "supplier-payments"

export type ProductInput = Omit<Product, "id" | "createdAt" | "createdBy" | "stock" | "total">

/** A product first bought on a purchase. The rest is filled in later on its page. */
export interface NewProductInput {
  name: string
  unit?: string
  price?: number
  barcode?: string
  category?: string
}

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

  addSupplier(input: Omit<Supplier, "id" | "createdAt" | "stats">) {
    return call<Supplier>("suppliers/", "POST", input, "suppliers")
  },
  async updateSupplier(id: string, patch: Partial<Omit<Supplier, "id" | "createdAt" | "stats">>) {
    // Purchases show the supplier's name too.
    await call(`suppliers/${id}/`, "PATCH", blanks(patch, ["company", "phone", "email", "address"]), "suppliers", "purchases")
  },
  async deleteSupplier(id: string) {
    await call(`suppliers/${id}/`, "DELETE", undefined, "suppliers")
  },
  /**
   * Stock bought in: it goes into stock at the location, and each product's cost is averaged in.
   * A line with `newProduct` creates that product with the purchase.
   */
  recordPurchase(input: {
    supplierId: string | null
    locationId: string
    items: ({ quantity: number; unitCost: number } & ({ productId: string } | { newProduct: NewProductInput }))[]
    reference?: string
    note?: string
    purchasedAt?: string
    /** What was paid now; the rest is owed. Left out means all of it. */
    paidAmount?: number
    paymentMethod?: "cash" | "mobile" | "bank"
    /** "YYYY-MM-DD", when the rest is due. */
    dueDate?: string
  }) {
    if (input.items.length === 0) throw new Error("Add at least one product.")
    for (const item of input.items) positiveInt(item.quantity)
    return call<Purchase>("purchases/", "POST", input, ...STOCK, "purchases", "suppliers", "supplier-payments")
  },

  /** Owners and admins: money paid to a supplier, given to their oldest unpaid bills first. */
  paySupplier(input: { supplierId: string; amount: number; method: "cash" | "mobile" | "bank"; paidAt?: string; note?: string }) {
    if (!(input.amount > 0)) throw new Error("Enter how much you paid.")
    return call<SupplierPayment>("supplier-payments/", "POST", input, "supplier-payments", "suppliers", "purchases")
  },
  /** A payment recorded by mistake: the bills it paid are owed again. */
  async deleteSupplierPayment(id: string) {
    await call(`supplier-payments/${id}/`, "DELETE", undefined, "supplier-payments", "suppliers", "purchases")
  },

  /** Sends broken or wrong stock from a purchase back. It leaves stock now. */
  returnToSupplier(itemId: string, quantity: number, reason: string) {
    positiveInt(quantity)
    if (!reason.trim()) throw new Error("Say what's wrong with it, e.g. broken.")
    return call<SupplierReturn>("supplier-returns/", "POST", { itemId, quantity, reason }, ...STOCK, "purchases", "suppliers", "supplier-returns")
  },
  /** The supplier sent new units instead: they go back into stock. */
  receiveReplacement(id: string, quantity: number) {
    positiveInt(quantity)
    return call<SupplierReturn>(`supplier-returns/${id}/replacement/`, "POST", { quantity }, ...STOCK, "suppliers", "supplier-returns")
  },
  receiveRefund(id: string, amount: number, method: RefundMethod) {
    if (!(amount > 0)) throw new Error("Enter the amount the supplier gave back.")
    return call<SupplierReturn>(`supplier-returns/${id}/refund/`, "POST", { amount, method }, "suppliers", "supplier-returns")
  },
  /** Owners and admins: settles the return by taking it off what's owed to the supplier. */
  creditReturn(id: string, amount: number) {
    if (!(amount > 0)) throw new Error("Enter the amount to take off.")
    return call<SupplierReturn>(`supplier-returns/${id}/credit/`, "POST", { amount }, "suppliers", "supplier-returns", "supplier-payments", "purchases")
  },
  /** Owners and admins: the supplier won't settle the rest. */
  closeReturn(id: string, note: string) {
    return call<SupplierReturn>(`supplier-returns/${id}/close/`, "POST", { note }, "suppliers", "supplier-returns")
  },

  /** A checkout: one or more items from one shop, one discount on the whole bill, one payment, one receipt. */
  sell(input: {
    locationId: string
    items: { productId: string; quantity: number; unitPrice: number }[]
    discount: number
    clientId?: string
    paymentMethod: Sale["paymentMethod"]
    paymentReference?: string
  }) {
    for (const item of input.items) positiveInt(item.quantity)
    return call<Sale>("sales/", "POST", input, ...STOCK, "sales", "clients")
  },
  /** Owners and admins: the stock goes back. Also approves a request. */
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
