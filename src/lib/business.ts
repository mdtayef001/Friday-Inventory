import type { BusinessSettings, ModuleId, PermissionId } from "@/lib/types"

// One subscription for every business: a flat monthly price, no usage limits.
// Online payment will be added later; for now the super admin marks a business
// as trial / active and suspends it if it doesn't pay.
export const SUBSCRIPTION = { price: 1000, currency: "BDT", period: "month" } as const

/** "৳1,000" */
export const formatTaka = (amount: number) => `৳${amount.toLocaleString("en-US")}`

export const PRICE_LABEL = `${formatTaka(SUBSCRIPTION.price)} / ${SUBSCRIPTION.period}`

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
