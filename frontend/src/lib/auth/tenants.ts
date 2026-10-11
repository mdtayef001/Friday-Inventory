import "server-only"
import { randomUUID } from "node:crypto"
import { addDays } from "date-fns"
import { DEMO_TENANT } from "@/lib/demo"
import { SUBSCRIPTION, businessStatus, defaultSettings } from "@/lib/business"
import type { Business, BusinessSettings } from "@/lib/types"

// Temporary in-memory business (tenant) store for the frontend test. It resets
// when the dev server restarts. The Django backend will replace this module.

export const DEMO_TENANT_ID = DEMO_TENANT

/** What's stored. `status` is worked out from the dates whenever a business is read. */
type StoredBusiness = Omit<Business, "status">

const day = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(Date.now() - days * day).toISOString()

function seed(): Map<string, StoredBusiness> {
  const list: StoredBusiness[] = [
    // Paid every month since its trial; 18 days left on the current month.
    { id: DEMO_TENANT_ID, name: "Friday Demo Store", industry: "Electronics & tools", suspended: false, trialEndsAt: ago(113), paidUntil: ago(-18), createdAt: ago(120), settings: defaultSettings() },
    // Still in the free trial, 2 days left, so the owner sees a reminder.
    { id: "b-greenleaf", name: "Green Leaf Café", industry: "Food & beverage", suspended: false, trialEndsAt: ago(-2), paidUntil: null, createdAt: ago(5), settings: { ...defaultSettings(), modules: { rentals: false, tracking: true, transfers: false } } },
    // Paid once, then stopped: locked until the owner pays.
    { id: "b-urban", name: "Urban Party Rentals", industry: "Event rentals", suspended: false, trialEndsAt: ago(38), paidUntil: ago(8), createdAt: ago(45), settings: defaultSettings() },
  ]
  return new Map(list.map((b) => [b.id, b]))
}

const globalStore = globalThis as unknown as { __fridayTenants?: Map<string, StoredBusiness> }
const store = (globalStore.__fridayTenants ??= seed())

const read = (b: StoredBusiness): Business => ({ ...structuredClone(b), status: businessStatus(b) })

export function findBusiness(id: string): Business | null {
  const b = store.get(id)
  return b ? read(b) : null
}

export function listBusinesses(): Business[] {
  return [...store.values()].map(read).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function insertBusiness(input: { name: string; industry: string }): Business {
  const now = new Date()
  const business: StoredBusiness = {
    id: `b-${randomUUID().slice(0, 8)}`,
    ...input,
    suspended: false,
    trialEndsAt: addDays(now, SUBSCRIPTION.trialDays).toISOString(),
    paidUntil: null,
    createdAt: now.toISOString(),
    settings: defaultSettings(),
  }
  store.set(business.id, business)
  return read(business)
}

export function patchBusiness(
  id: string,
  patch: Partial<Pick<Business, "name" | "industry" | "suspended" | "paidUntil">> & { settings?: BusinessSettings },
) {
  const b = store.get(id)
  if (!b) return null
  Object.assign(b, patch)
  return read(b)
}

export function removeBusiness(id: string) {
  return store.delete(id)
}
