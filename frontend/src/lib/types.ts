// Shared domain types. These mirror the shapes the Django REST API will
// return later, so pages won't need to change when the backend lands.

/**
 * superadmin: runs the platform (you). Creates businesses and their owners.
 * owner: runs one business. Decides features and what everyone else can do.
 * manager / staff: work at a business, limited to their assigned locations.
 */
export type Role = "superadmin" | "owner" | "manager" | "staff"
export type TenantRole = Exclude<Role, "superadmin">

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
  /** The business this user belongs to. Null for the platform super admin. */
  tenantId: string | null
  /** Locations this user works at. Empty for owners (they see everything). */
  locationIds: string[]
}

export interface ManagedUser extends SessionUser {
  active: boolean
  createdAt: string
  createdBy: string | null
  lastLoginAt?: string
}

// ---------- Platform (multi-business) ----------

/**
 * Worked out from dates on every request, never stored:
 * trial: inside the 7-day free trial. active: paid up.
 * unpaid: trial or paid month ran out, so access is locked until the owner pays.
 * suspended: the super admin switched the business off by hand.
 */
export type BusinessStatus = "trial" | "active" | "unpaid" | "suspended"
export type ModuleId = "rentals" | "tracking" | "transfers" | "trackingLinks"

/** Things an owner can switch on or off for managers and staff. */
export interface Permissions {
  managerUsers: boolean
  managerActivity: boolean
  managerProfit: boolean
  managerProducts: boolean
  managerLocations: boolean
  staffCreateProducts: boolean
}
export type PermissionId = keyof Permissions

export interface BusinessSettings {
  currency: string
  modules: Record<ModuleId, boolean>
  permissions: Permissions
}

export interface Business {
  id: string
  name: string
  industry: string
  status: BusinessStatus
  /** Set by the super admin. Blocks everyone, even after paying. */
  suspended: boolean
  trialEndsAt: string
  /** End of the last paid month. Null until the first payment. */
  paidUntil: string | null
  createdAt: string
  settings: BusinessSettings
}

export type PaymentStatus = "pending" | "paid" | "failed" | "cancelled"

export interface Payment {
  id: string
  /** Our transaction id, sent to SSLCommerz as tran_id. */
  tranId: string
  businessId: string
  businessName: string
  amount: number
  currency: string
  status: PaymentStatus
  /** e.g. "bKash", "VISA-Dutch Bangla". Filled in once paid. */
  method?: string
  createdAt: string
  paidAt?: string
  /** The month this payment covers. */
  periodStart?: string
  periodEnd?: string
  invoiceNo?: string
  /** SSLCommerz references, kept for support and refunds. */
  valId?: string
  bankTranId?: string
  payer: { name: string; email: string; phone: string }
}

export interface BusinessSummary extends Business {
  owner: { id: string; name: string; email: string } | null
  userCount: number
  lastActiveAt?: string
}

export type LocationType = "warehouse" | "outlet"

export interface Location {
  id: string
  name: string
  type: LocationType
  address: string
  phone?: string
}

export interface RentRates {
  daily?: number
  weekly?: number
  monthly?: number
}

export interface Product {
  id: string
  sku: string
  barcode?: string
  name: string
  category: string
  unit: string
  description?: string
  price: number
  cost: number
  lowStockThreshold: number
  rentable: boolean
  rentRates?: RentRates
  createdAt: string
  createdBy: string
}

export interface StockLevel {
  productId: string
  locationId: string
  quantity: number
}

export interface Client {
  id: string
  name: string
  company?: string
  phone?: string
  email?: string
  address?: string
  createdAt: string
}

export type ShipmentStatus =
  | "pending"
  | "processing"
  | "in_delivery"
  | "delivered"
  | "returned"
  | "cancelled"

export interface StatusEvent<S extends string> {
  status: S
  at: string
  by: string
  note?: string
}

export interface Shipment {
  id: string
  code: string
  /** Key to the client's public tracking page, /track/<token>. */
  trackingToken: string
  productId: string
  quantity: number
  /** Price per unit agreed when the order was placed. Null on orders from before sales tracking. */
  unitPrice: number | null
  clientId: string
  fromLocationId: string
  status: ShipmentStatus
  notes?: string
  createdAt: string
  history: StatusEvent<ShipmentStatus>[]
}

export type RentalPlan = "daily" | "weekly" | "monthly" | "fixed"
export type RentalStatus = "active" | "returned"

export interface Rental {
  id: string
  code: string
  productId: string
  quantity: number
  clientId: string
  locationId: string
  startDate: string
  days: number
  plan: RentalPlan
  /** Price per day/week/month, or the flat amount when plan is "fixed". */
  rate: number
  deposit: number
  total: number
  status: RentalStatus
  returnedAt?: string
  notes?: string
  createdAt: string
}

export type TransferStatus = "in_transit" | "received" | "cancelled"

export interface Transfer {
  id: string
  code: string
  productId: string
  quantity: number
  fromLocationId: string
  toLocationId: string
  status: TransferStatus
  createdAt: string
  createdBy: string
  receivedAt?: string
}

export interface Activity {
  id: string
  at: string
  user: string
  action: string
  detail: string
}

/** What a client sees on their public tracking page. */
export interface PublicTracking {
  code: string
  businessName: string
  productName: string
  quantity: number
  status: ShipmentStatus
  createdAt: string
  contactPhone: string
  history: { status: ShipmentStatus; at: string }[]
}

export type SaleChannel = "store" | "order" | "rental"

/** Money in, with the price (and for the owner, the cost) frozen at the moment of sale. */
export interface Sale {
  id: string
  channel: SaleChannel
  productId: string | null
  productName: string
  quantity: number
  unitPrice: number
  discount: number
  revenue: number
  /** Owner only. */
  unitCost?: number
  cost?: number
  profit?: number
  locationId: string | null
  clientId: string | null
  orderId: string | null
  rentalId: string | null
  soldBy: string
  soldAt: string
  /** Set when the goods came back; refunded sales don't count. */
  refundedAt: string | null
}
