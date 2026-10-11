"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type {
  Client,
  Location,
  Product,
  Rental,
  Shipment,
  ShipmentStatus,
  StockLevel,
  Transfer,
} from "@/lib/types"
import { quoteRental } from "@/lib/rental"
import { refCode, uid } from "@/lib/format"
import { createEmpty, createSeed, type SeedData } from "./seed"

// Each business gets its own saved data. <StoreGate> calls loadTenant() with
// the logged-in business before any page renders.
interface TenantConfig {
  id: string
  demo: boolean
}
let tenant: TenantConfig = { id: "none", demo: true }
let loaded = false
const storageKey = (id: string) => `friday-inventory:${id}`
const initialData = () => (tenant.demo ? createSeed() : createEmpty())

// Client-side data store for the frontend test, saved in localStorage.
// Every mutation lives here, so swapping in Django REST calls later only
// touches this file. Actions throw an Error with a readable message when
// something isn't allowed (e.g. not enough stock); callers show it as a toast.

export type ProductInput = Omit<Product, "id" | "createdAt" | "createdBy">

interface Actions {
  addProduct(input: ProductInput, initial: { locationId: string; quantity: number } | null, by: string): Product
  updateProduct(id: string, patch: Partial<ProductInput>, by: string): void
  deleteProduct(id: string, by: string): void
  adjustStock(productId: string, locationId: string, delta: number, reason: string, by: string): void

  addLocation(input: Omit<Location, "id">, by: string): Location
  updateLocation(id: string, patch: Partial<Omit<Location, "id">>, by: string): void
  deleteLocation(id: string, by: string): void

  addClient(input: Omit<Client, "id" | "createdAt">, by: string): Client
  updateClient(id: string, patch: Partial<Omit<Client, "id" | "createdAt">>, by: string): void
  deleteClient(id: string, by: string): void

  createShipment(input: Pick<Shipment, "productId" | "quantity" | "clientId" | "fromLocationId" | "notes">, by: string): Shipment
  setShipmentStatus(id: string, status: ShipmentStatus, by: string, note?: string): void

  createRental(
    input: Pick<Rental, "productId" | "quantity" | "clientId" | "locationId" | "startDate" | "days" | "plan" | "rate" | "deposit" | "notes">,
    by: string,
  ): Rental
  returnRental(id: string, by: string): void

  createTransfer(input: Pick<Transfer, "productId" | "quantity" | "fromLocationId" | "toLocationId">, by: string): Transfer
  receiveTransfer(id: string, by: string): void
  cancelTransfer(id: string, by: string): void

  /** Back to the starting data: demo data for the demo business, empty otherwise. */
  resetDemoData(): void
}

export type Store = SeedData & Actions

/** Shipment statuses after which the goods are back on the shelf. */
const RESTOCKED: ShipmentStatus[] = ["returned", "cancelled"]

export function qtyAt(stock: StockLevel[], productId: string, locationId: string) {
  return stock.find((s) => s.productId === productId && s.locationId === locationId)?.quantity ?? 0
}

function withQty(stock: StockLevel[], productId: string, locationId: string, delta: number): StockLevel[] {
  const current = qtyAt(stock, productId, locationId)
  const next = current + delta
  if (next < 0) throw new Error(`Not enough stock: only ${current} available at this location.`)
  const rest = stock.filter((s) => !(s.productId === productId && s.locationId === locationId))
  return next === 0 ? rest : [...rest, { productId, locationId, quantity: next }]
}

function positiveInt(n: number, label = "Quantity") {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a whole number above 0.`)
}

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      const log = (user: string, action: string, detail: string) =>
        set((s) => ({
          activity: [{ id: uid("ac"), at: new Date().toISOString(), user, action, detail }, ...s.activity].slice(0, 500),
        }))
      const productName = (id: string) => get().products.find((p) => p.id === id)?.name ?? "Unknown product"
      const locationName = (id: string) => get().locations.find((l) => l.id === id)?.name ?? "Unknown location"
      const clientName = (id: string) => get().clients.find((c) => c.id === id)?.name ?? "Unknown client"

      return {
        ...createEmpty(),

        addProduct(input, initial, by) {
          const { products } = get()
          if (products.some((p) => p.sku.toLowerCase() === input.sku.toLowerCase())) {
            throw new Error(`SKU "${input.sku}" is already used by another product.`)
          }
          if (input.barcode && products.some((p) => p.barcode === input.barcode)) {
            throw new Error(`Barcode "${input.barcode}" is already used by another product.`)
          }
          const product: Product = { ...input, id: uid("prd"), createdAt: new Date().toISOString(), createdBy: by }
          set((s) => ({
            products: [product, ...s.products],
            stock: initial && initial.quantity > 0 ? withQty(s.stock, product.id, initial.locationId, initial.quantity) : s.stock,
          }))
          log(
            by,
            "Product added",
            initial && initial.quantity > 0
              ? `${product.name} · ${initial.quantity} ${product.unit} at ${locationName(initial.locationId)}`
              : product.name,
          )
          return product
        },

        updateProduct(id, patch, by) {
          const { products } = get()
          if (patch.sku && products.some((p) => p.id !== id && p.sku.toLowerCase() === patch.sku!.toLowerCase())) {
            throw new Error(`SKU "${patch.sku}" is already used by another product.`)
          }
          if (patch.barcode && products.some((p) => p.id !== id && p.barcode === patch.barcode)) {
            throw new Error(`Barcode "${patch.barcode}" is already used by another product.`)
          }
          set((s) => ({ products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
          log(by, "Product updated", productName(id))
        },

        deleteProduct(id, by) {
          const { rentals, shipments, transfers } = get()
          if (rentals.some((r) => r.productId === id && r.status === "active")) {
            throw new Error("This product has active rentals. Return them first.")
          }
          if (shipments.some((sh) => sh.productId === id && !["delivered", ...RESTOCKED].includes(sh.status))) {
            throw new Error("This product has open shipments. Finish or cancel them first.")
          }
          if (transfers.some((t) => t.productId === id && t.status === "in_transit")) {
            throw new Error("This product has transfers in transit.")
          }
          const name = productName(id)
          set((s) => ({
            products: s.products.filter((p) => p.id !== id),
            stock: s.stock.filter((row) => row.productId !== id),
          }))
          log(by, "Product deleted", name)
        },

        adjustStock(productId, locationId, delta, reason, by) {
          if (!Number.isInteger(delta) || delta === 0) throw new Error("Enter a whole number that isn't 0.")
          set((s) => ({ stock: withQty(s.stock, productId, locationId, delta) }))
          log(
            by,
            delta > 0 ? "Stock added" : "Stock removed",
            `${delta > 0 ? "+" : ""}${delta} ${productName(productId)} at ${locationName(locationId)}${reason ? ` · ${reason}` : ""}`,
          )
        },

        addLocation(input, by) {
          const location: Location = { ...input, id: uid("loc") }
          set((s) => ({ locations: [...s.locations, location] }))
          log(by, "Location added", `${location.name} (${location.type})`)
          return location
        },

        updateLocation(id, patch, by) {
          set((s) => ({ locations: s.locations.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
          log(by, "Location updated", locationName(id))
        },

        deleteLocation(id, by) {
          const { stock, rentals, transfers } = get()
          if (stock.some((row) => row.locationId === id)) {
            throw new Error("This location still has stock. Move or remove it first.")
          }
          if (rentals.some((r) => r.locationId === id && r.status === "active")) {
            throw new Error("This location has active rentals.")
          }
          if (transfers.some((t) => t.status === "in_transit" && (t.fromLocationId === id || t.toLocationId === id))) {
            throw new Error("This location has transfers in transit.")
          }
          const name = locationName(id)
          set((s) => ({ locations: s.locations.filter((l) => l.id !== id) }))
          log(by, "Location deleted", name)
        },

        addClient(input, by) {
          const client: Client = { ...input, id: uid("cl"), createdAt: new Date().toISOString() }
          set((s) => ({ clients: [client, ...s.clients] }))
          log(by, "Client added", client.name)
          return client
        },

        updateClient(id, patch, by) {
          set((s) => ({ clients: s.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
          log(by, "Client updated", clientName(id))
        },

        deleteClient(id, by) {
          const { rentals, shipments } = get()
          if (rentals.some((r) => r.clientId === id && r.status === "active")) {
            throw new Error("This client has active rentals.")
          }
          if (shipments.some((sh) => sh.clientId === id && !["delivered", ...RESTOCKED].includes(sh.status))) {
            throw new Error("This client has open shipments.")
          }
          const name = clientName(id)
          set((s) => ({ clients: s.clients.filter((c) => c.id !== id) }))
          log(by, "Client deleted", name)
        },

        createShipment(input, by) {
          positiveInt(input.quantity)
          const now = new Date().toISOString()
          const shipment: Shipment = {
            ...input,
            id: uid("sh"),
            code: refCode("SHP"),
            status: "pending",
            createdAt: now,
            history: [{ status: "pending", at: now, by }],
          }
          set((s) => ({
            stock: withQty(s.stock, input.productId, input.fromLocationId, -input.quantity),
            shipments: [shipment, ...s.shipments],
          }))
          log(by, "Shipment created", `${shipment.code} · ${input.quantity} × ${productName(input.productId)} to ${clientName(input.clientId)}`)
          return shipment
        },

        setShipmentStatus(id, status, by, note) {
          const shipment = get().shipments.find((sh) => sh.id === id)
          if (!shipment) throw new Error("Shipment not found.")
          if (RESTOCKED.includes(shipment.status)) throw new Error("This shipment is closed.")
          if (shipment.status === status) return
          const restock = RESTOCKED.includes(status)
          set((s) => ({
            stock: restock ? withQty(s.stock, shipment.productId, shipment.fromLocationId, shipment.quantity) : s.stock,
            shipments: s.shipments.map((sh) =>
              sh.id === id
                ? { ...sh, status, history: [...sh.history, { status, at: new Date().toISOString(), by, note }] }
                : sh,
            ),
          }))
          log(by, "Shipment updated", `${shipment.code} → ${status.replace("_", " ")}${restock ? " (restocked)" : ""}`)
        },

        createRental(input, by) {
          positiveInt(input.quantity)
          positiveInt(input.days, "Rental days")
          const product = get().products.find((p) => p.id === input.productId)
          if (!product?.rentable) throw new Error("This product isn't available for rent.")
          const rental: Rental = {
            ...input,
            id: uid("rn"),
            code: refCode("RNT"),
            total: quoteRental(input.plan, input.rate, input.days, input.quantity).total,
            status: "active",
            createdAt: new Date().toISOString(),
          }
          set((s) => ({
            stock: withQty(s.stock, input.productId, input.locationId, -input.quantity),
            rentals: [rental, ...s.rentals],
          }))
          log(by, "Rental created", `${rental.code} · ${input.quantity} × ${product.name} to ${clientName(input.clientId)}`)
          return rental
        },

        returnRental(id, by) {
          const rental = get().rentals.find((r) => r.id === id)
          if (!rental || rental.status !== "active") throw new Error("This rental is not active.")
          set((s) => ({
            stock: withQty(s.stock, rental.productId, rental.locationId, rental.quantity),
            rentals: s.rentals.map((r) =>
              r.id === id ? { ...r, status: "returned", returnedAt: new Date().toISOString() } : r,
            ),
          }))
          log(by, "Rental returned", `${rental.code} · ${productName(rental.productId)} back at ${locationName(rental.locationId)}`)
        },

        createTransfer(input, by) {
          positiveInt(input.quantity)
          if (input.fromLocationId === input.toLocationId) throw new Error("Choose two different locations.")
          const transfer: Transfer = {
            ...input,
            id: uid("tr"),
            code: refCode("TRF"),
            status: "in_transit",
            createdAt: new Date().toISOString(),
            createdBy: by,
          }
          set((s) => ({
            stock: withQty(s.stock, input.productId, input.fromLocationId, -input.quantity),
            transfers: [transfer, ...s.transfers],
          }))
          log(
            by,
            "Transfer started",
            `${transfer.code} · ${input.quantity} × ${productName(input.productId)} ${locationName(input.fromLocationId)} → ${locationName(input.toLocationId)}`,
          )
          return transfer
        },

        receiveTransfer(id, by) {
          const transfer = get().transfers.find((t) => t.id === id)
          if (!transfer || transfer.status !== "in_transit") throw new Error("This transfer is not in transit.")
          set((s) => ({
            stock: withQty(s.stock, transfer.productId, transfer.toLocationId, transfer.quantity),
            transfers: s.transfers.map((t) =>
              t.id === id ? { ...t, status: "received", receivedAt: new Date().toISOString() } : t,
            ),
          }))
          log(by, "Transfer received", `${transfer.code} at ${locationName(transfer.toLocationId)}`)
        },

        cancelTransfer(id, by) {
          const transfer = get().transfers.find((t) => t.id === id)
          if (!transfer || transfer.status !== "in_transit") throw new Error("This transfer is not in transit.")
          set((s) => ({
            stock: withQty(s.stock, transfer.productId, transfer.fromLocationId, transfer.quantity),
            transfers: s.transfers.map((t) => (t.id === id ? { ...t, status: "cancelled" } : t)),
          }))
          log(by, "Transfer cancelled", `${transfer.code} · stock returned to ${locationName(transfer.fromLocationId)}`)
        },

        resetDemoData() {
          set(initialData())
        },
      }
    },
    {
      name: storageKey("none"),
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Rehydrated manually in <StoreGate> to avoid server/client mismatches.
      skipHydration: true,
      partialize: ({ locations, products, stock, clients, shipments, rentals, transfers, activity }) => ({
        locations,
        products,
        stock,
        clients,
        shipments,
        rentals,
        transfers,
        activity,
      }),
    },
  ),
)

/**
 * Switch the store to a business. Loads its saved data, or its starting data
 * the first time. Safe to call again with the same business.
 */
export async function loadTenant(config: TenantConfig) {
  const changed = config.id !== tenant.id
  tenant = config
  if (!changed && loaded) return
  const name = storageKey(config.id)
  useStore.persist.setOptions({ name })
  let saved = false
  try {
    saved = localStorage.getItem(name) !== null
  } catch {
    // Storage blocked (private mode etc.): fall back to starting data.
  }
  if (saved) await useStore.persist.rehydrate()
  else useStore.setState(initialData())
  loaded = true
}
