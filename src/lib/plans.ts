import type { BusinessSettings, ModuleId, PermissionId, PlanId } from "@/lib/types"

// Subscription plans. Limits are checked when creating users (server) and
// locations / products (client store; the Django API will enforce them later).

export interface Plan {
  id: PlanId
  name: string
  price: number
  blurb: string
  limits: { locations: number; users: number; products: number }
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", price: 0, blurb: "One shop getting started", limits: { locations: 1, users: 3, products: 50 } },
  starter: { id: "starter", name: "Starter", price: 29, blurb: "A few shops and a small team", limits: { locations: 3, users: 10, products: 1000 } },
  pro: { id: "pro", name: "Pro", price: 79, blurb: "Many outlets, no limits", limits: { locations: Infinity, users: Infinity, products: Infinity } },
}

export const PLAN_IDS = Object.keys(PLANS) as PlanId[]

export const formatLimit = (n: number) => (Number.isFinite(n) ? String(n) : "Unlimited")

export const MODULES: Record<ModuleId, { label: string; description: string }> = {
  rentals: { label: "Rentals", description: "Rent items out by day, week, month or a fixed price." },
  tracking: { label: "Orders & delivery tracking", description: "Track orders from pending to delivered." },
  transfers: { label: "Stock transfers", description: "Move stock between warehouses and shops." },
}

export const PERMISSIONS: Record<PermissionId, { label: string; description: string; role: "manager" | "staff" }> = {
  managerUsers: { label: "Manage staff accounts", description: "Create, disable and reset staff logins at their shops.", role: "manager" },
  managerProducts: { label: "Add, edit and delete products", description: "Otherwise they can view products and change stock only.", role: "manager" },
  managerLocations: { label: "Edit their shop details", description: "Change name, address and phone of shops they run.", role: "manager" },
  managerActivity: { label: "See the activity log", description: "Who did what, and when.", role: "manager" },
  staffCreateProducts: { label: "Create new products", description: "When a scanned code is unknown. Otherwise staff only add stock.", role: "staff" },
}

export const CURRENCIES = ["USD", "EUR", "GBP", "BDT", "INR", "AED", "SAR", "CAD", "AUD"]

export function defaultSettings(): BusinessSettings {
  return {
    currency: "USD",
    modules: { rentals: true, tracking: true, transfers: true },
    permissions: {
      managerUsers: true,
      managerActivity: false,
      managerProducts: true,
      managerLocations: false,
      staffCreateProducts: true,
    },
  }
}
