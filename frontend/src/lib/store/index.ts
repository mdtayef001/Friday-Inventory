"use client"

import { create } from "zustand"
import { request } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import type {
  Activity,
  Business,
  Client,
  Location,
  Product,
  Rental,
  SessionUser,
  Shipment,
  ShipmentStatus,
  StockLevel,
  Transfer,
} from "@/lib/types"

// Client-side copy of the business's data, loaded from the Django API by
// <StoreGate>. Every change goes to the API first; Django does the stock
// maths, permission checks and activity log, then the store reloads what
// changed. Actions reject with an Error carrying a readable message (e.g. not
// enough stock); callers show it as a toast.

export interface Data {
  locations: Location[]
  products: Product[]
  stock: StockLevel[]
  clients: Client[]
  shipments: Shipment[]
  rentals: Rental[]
  transfers: Transfer[]
  activity: Activity[]
}
type Collection = keyof Data

export type ProductInput = Omit<Product, "id" | "createdAt" | "createdBy">

interface Actions {
  addProduct(input: ProductInput, initial: { locationId: string; quantity: number } | null): Promise<Product>
  updateProduct(id: string, patch: Partial<ProductInput>): Promise<void>
  deleteProduct(id: string): Promise<void>
  adjustStock(productId: string, locationId: string, delta: number, reason: string): Promise<void>

  addLocation(input: Omit<Location, "id">): Promise<Location>
  updateLocation(id: string, patch: Partial<Omit<Location, "id">>): Promise<void>
  deleteLocation(id: string): Promise<void>

  addClient(input: Omit<Client, "id" | "createdAt">): Promise<Client>
  updateClient(id: string, patch: Partial<Omit<Client, "id" | "createdAt">>): Promise<void>
  deleteClient(id: string): Promise<void>

  createShipment(input: Pick<Shipment, "productId" | "quantity" | "clientId" | "fromLocationId" | "notes">): Promise<Shipment>
  setShipmentStatus(id: string, status: ShipmentStatus, note?: string): Promise<void>

  createRental(
    input: Pick<Rental, "productId" | "quantity" | "clientId" | "locationId" | "startDate" | "days" | "plan" | "rate" | "deposit" | "notes">,
  ): Promise<Rental>
  returnRental(id: string): Promise<void>

  createTransfer(input: Pick<Transfer, "productId" | "quantity" | "fromLocationId" | "toLocationId">): Promise<Transfer>
  receiveTransfer(id: string): Promise<void>
  cancelTransfer(id: string): Promise<void>
}

export type Store = Data & Actions

const empty = (): Data => ({
  locations: [],
  products: [],
  stock: [],
  clients: [],
  shipments: [],
  rentals: [],
  transfers: [],
  activity: [],
})

/** Which API list each collection comes from. */
const ENDPOINT: Record<Collection, string> = {
  locations: "locations/",
  products: "products/",
  stock: "stock/",
  clients: "clients/",
  shipments: "shipments/",
  rentals: "rentals/",
  transfers: "transfers/",
  activity: "activity/",
}

/** Collections this user may read; the rest stay empty instead of failing. */
let readable: Collection[] = []

export function qtyAt(stock: StockLevel[], productId: string, locationId: string) {
  return stock.find((s) => s.productId === productId && s.locationId === locationId)?.quantity ?? 0
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

async function fetchCollection(name: Collection) {
  try {
    return await request<Data[typeof name]>(ENDPOINT[name])
  } catch (err) {
    // Turned off by the owner since the page loaded: show nothing rather than fail.
    if (err instanceof ApiError && err.status === 403) return []
    throw err
  }
}

export const useStore = create<Store>()((set) => {
  /** Re-reads collections after a change so the page shows what Django saved. */
  async function reload(...names: Collection[]) {
    const wanted = names.filter((n) => readable.includes(n))
    const lists = await Promise.all(wanted.map(fetchCollection))
    set(Object.fromEntries(wanted.map((n, i) => [n, lists[i]])) as Partial<Data>)
  }

  async function call<T>(path: string, method: string, body: unknown, ...after: Collection[]) {
    const result = await request<T>(path, { method, body })
    await reload(...after, "activity")
    return result
  }

  return {
    ...empty(),

    async addProduct(input, initial) {
      return call<Product>(
        "products/",
        "POST",
        { ...input, initialLocationId: initial?.locationId ?? null, initialQuantity: initial?.quantity ?? 0 },
        "products",
        "stock",
      )
    },
    async updateProduct(id, patch) {
      await call(`products/${id}/`, "PATCH", blanks(patch, ["barcode", "description"]), "products")
    },
    async deleteProduct(id) {
      await call(`products/${id}/`, "DELETE", undefined, "products", "stock")
    },
    async adjustStock(productId, locationId, delta, reason) {
      if (!Number.isInteger(delta) || delta === 0) throw new Error("Enter a whole number that isn't 0.")
      await call("stock/adjust/", "POST", { productId, locationId, delta, reason }, "stock")
    },

    async addLocation(input) {
      return call<Location>("locations/", "POST", input, "locations")
    },
    async updateLocation(id, patch) {
      await call(`locations/${id}/`, "PATCH", blanks(patch, ["phone", "address"]), "locations")
    },
    async deleteLocation(id) {
      await call(`locations/${id}/`, "DELETE", undefined, "locations", "stock")
    },

    async addClient(input) {
      return call<Client>("clients/", "POST", input, "clients")
    },
    async updateClient(id, patch) {
      await call(`clients/${id}/`, "PATCH", blanks(patch, ["company", "phone", "email", "address"]), "clients")
    },
    async deleteClient(id) {
      await call(`clients/${id}/`, "DELETE", undefined, "clients")
    },

    async createShipment(input) {
      positiveInt(input.quantity)
      return call<Shipment>("shipments/", "POST", input, "shipments", "stock")
    },
    async setShipmentStatus(id, status, note) {
      await call(`shipments/${id}/status/`, "POST", { status, note: note ?? "" }, "shipments", "stock")
    },

    async createRental(input) {
      positiveInt(input.quantity)
      positiveInt(input.days, "Rental days")
      return call<Rental>("rentals/", "POST", input, "rentals", "stock")
    },
    async returnRental(id) {
      await call(`rentals/${id}/return/`, "POST", {}, "rentals", "stock")
    },

    async createTransfer(input) {
      positiveInt(input.quantity)
      if (input.fromLocationId === input.toLocationId) throw new Error("Choose two different locations.")
      return call<Transfer>("transfers/", "POST", input, "transfers", "stock")
    },
    async receiveTransfer(id) {
      await call(`transfers/${id}/receive/`, "POST", {}, "transfers", "stock")
    },
    async cancelTransfer(id) {
      await call(`transfers/${id}/cancel/`, "POST", {}, "transfers", "stock")
    },
  }
})

/** What this user's role and the owner's switches let them read. Mirrors the Django permissions. */
function readableFor(user: SessionUser, business: Business): Collection[] {
  const names: Collection[] = ["locations", "products", "stock"]
  if (user.role === "staff") return names
  const { modules, permissions } = business.settings
  names.push("clients")
  if (modules.tracking) names.push("shipments")
  if (modules.rentals) names.push("rentals")
  if (modules.transfers) names.push("transfers")
  if (user.role === "owner" || permissions.managerActivity) names.push("activity")
  return names
}

/** Loads everything the user can see for their business. Safe to call again. */
export async function loadTenant(user: SessionUser, business: Business) {
  readable = readableFor(user, business)
  const lists = await Promise.all(readable.map(fetchCollection))
  useStore.setState({ ...empty(), ...Object.fromEntries(readable.map((n, i) => [n, lists[i]])) })
}
