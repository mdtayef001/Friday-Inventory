import type { BusinessSettings, BusinessStatus, ModuleId, PaymentMethod, PermissionId } from "@/lib/types"

// One subscription for every business: a flat monthly price, no usage limits.
// New businesses get a free trial; when the trial or a paid month runs out the
// business locks itself until the owner pays through SSLCommerz.
export const SUBSCRIPTION = { price: 1000, currency: "BDT", period: "month", trialDays: 7 } as const

/** Shown on invoices as the seller. Change to your company details. */
export const PLATFORM = {
  name: "Friday Inventory",
  address: "Dhaka, Bangladesh",
  email: "billing@friday.app",
}

/** Owners see a reminder when this many days or fewer are left. */
export const REMINDER_DAYS = 3

export function businessStatus(b: { suspended: boolean; trialEndsAt: string; paidUntil: string | null }, now = Date.now()): BusinessStatus {
  if (b.suspended) return "suspended"
  if (b.paidUntil && Date.parse(b.paidUntil) > now) return "active"
  if (Date.parse(b.trialEndsAt) > now) return "trial"
  return "unpaid"
}

/** When access runs out: end of the trial or of the paid month, whichever is later. */
export function accessEndsAt(b: { trialEndsAt: string; paidUntil: string | null }) {
  return b.paidUntil && b.paidUntil > b.trialEndsAt ? b.paidUntil : b.trialEndsAt
}

export function daysLeft(iso: string, now = Date.now()) {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 86_400_000))
}

/** "৳1,000" */
export const formatTaka = (amount: number) => `৳${amount.toLocaleString("en-US")}`

export const PRICE_LABEL = `${formatTaka(SUBSCRIPTION.price)} / ${SUBSCRIPTION.period}`

export const MODULES: Record<ModuleId, { label: string; description: string }> = {
  rentals: { label: "Rentals", description: "Rent items out by day, week, month or a fixed price." },
  tracking: { label: "Orders & delivery tracking", description: "Track orders from pending to delivered." },
  transfers: { label: "Stock transfers", description: "Move stock between warehouses and shops." },
  trackingLinks: { label: "Client tracking links", description: "Send clients a link to check their order status. No login needed." },
}

export const PERMISSIONS: Record<PermissionId, { label: string; description: string; role: "manager" | "staff" }> = {
  managerUsers: { label: "Manage staff accounts", description: "Create, disable and reset staff logins at their shops.", role: "manager" },
  managerProducts: { label: "Add, edit and delete products", description: "Otherwise they can view products and change stock only.", role: "manager" },
  managerLocations: { label: "Edit their shop details", description: "Change name, address and phone of shops they run.", role: "manager" },
  managerActivity: { label: "See the activity log", description: "Who did what, and when.", role: "manager" },
  managerProfit: { label: "See cost and profit", description: "On the Sales page and when selling. Otherwise they see prices only.", role: "manager" },
  staffCreateProducts: { label: "Create new products", description: "When a scanned code is unknown. Otherwise staff only add stock.", role: "staff" },
}

/** Currencies a business can choose. One set before this list was narrowed still works. */
export const CURRENCIES = ["BDT", "USD"]
export const CURRENCY_LABEL: Record<string, string> = { BDT: "৳ Bangladeshi taka (BDT)", USD: "$ US dollar (USD)" }

export function defaultSettings(): BusinessSettings {
  return {
    currency: "USD",
    modules: { rentals: true, tracking: true, transfers: true, trackingLinks: true },
    permissions: {
      managerUsers: true,
      managerActivity: false,
      managerProfit: false,
      managerProducts: true,
      managerLocations: false,
      staffCreateProducts: true,
    },
    payments: { mobile: false, card: false, online: false },
  }
}

export const PAYMENT_METHODS: Record<PaymentMethod, { label: string; short: string }> = {
  cash: { label: "Cash", short: "Cash" },
  mobile: { label: "Mobile banking (bKash / Nagad)", short: "Mobile" },
  card: { label: "Card machine", short: "Card" },
  online: { label: "Online (SSLCommerz)", short: "Online" },
}

/** The payment methods this business has switched on. Cash always. */
export function enabledMethods(settings: BusinessSettings): PaymentMethod[] {
  const p = settings.payments
  const on: PaymentMethod[] = ["cash"]
  if (p?.mobile) on.push("mobile")
  if (p?.card) on.push("card")
  if (p?.online) on.push("online")
  return on
}
