import "server-only"
import { randomUUID } from "node:crypto"
import { DEMO_TENANT } from "@/lib/demo"
import { defaultSettings } from "@/lib/business"
import type { Business, BusinessSettings, BusinessStatus } from "@/lib/types"

// Temporary in-memory business (tenant) store for the frontend test. It resets
// when the dev server restarts. The Django backend will replace this module.

export const DEMO_TENANT_ID = DEMO_TENANT

function seed(): Map<string, Business> {
  const day = 24 * 60 * 60 * 1000
  const ago = (days: number) => new Date(Date.now() - days * day).toISOString()
  const list: Business[] = [
    { id: DEMO_TENANT_ID, name: "Friday Demo Store", industry: "Electronics & tools", status: "active", createdAt: ago(120), settings: defaultSettings() },
    { id: "b-greenleaf", name: "Green Leaf Café", industry: "Food & beverage", status: "trial", createdAt: ago(6), settings: { ...defaultSettings(), modules: { rentals: false, tracking: true, transfers: false } } },
    { id: "b-urban", name: "Urban Party Rentals", industry: "Event rentals", status: "suspended", createdAt: ago(45), settings: defaultSettings() },
  ]
  return new Map(list.map((b) => [b.id, b]))
}

const globalStore = globalThis as unknown as { __fridayTenants?: Map<string, Business> }
const store = (globalStore.__fridayTenants ??= seed())

const copy = (b: Business): Business => structuredClone(b)

export function findBusiness(id: string): Business | null {
  const b = store.get(id)
  return b ? copy(b) : null
}

export function listBusinesses(): Business[] {
  return [...store.values()].map(copy).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function insertBusiness(input: { name: string; industry: string; status: BusinessStatus }): Business {
  const business: Business = {
    id: `b-${randomUUID().slice(0, 8)}`,
    ...input,
    createdAt: new Date().toISOString(),
    settings: defaultSettings(),
  }
  store.set(business.id, business)
  return copy(business)
}

export function patchBusiness(
  id: string,
  patch: Partial<Pick<Business, "name" | "industry" | "status">> & { settings?: BusinessSettings },
) {
  const b = store.get(id)
  if (!b) return null
  Object.assign(b, patch)
  return copy(b)
}

export function removeBusiness(id: string) {
  return store.delete(id)
}
