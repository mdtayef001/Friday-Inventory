// Shared domain types. These mirror the shapes the Django REST API returns.

/** One page of a list. Ask for it with ?page= (and ?page_size=). */
export interface Page<T> {
  count: number
  /** The page actually returned; past the end, the server sends the last one. */
  page: number
  results: T[]
}

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
  /** Per-person rights. Always true for owners and managers; set per staff member. */
  canSell: boolean
  canAddStock: boolean
  /** The business's Owner (its first owner account). Other owner-level accounts are admins. */
  isMainOwner: boolean
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
  managerPurchases: boolean
}
export type PermissionId = keyof Permissions

/** How customers can pay. Cash always works; the rest are the owner's choice. */
export interface PaymentSettings {
  mobile: boolean
  /** Shown to staff and customers, e.g. "bKash 01711000000". */
  card: boolean
}

export interface BusinessSettings {
  currency: string
  modules: Record<ModuleId, boolean>
  permissions: Permissions
  payments: PaymentSettings
}

export type PaymentMethod = "cash" | "mobile" | "card"

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

/** "awaiting": sent by hand (bKash, bank...), waiting for the super admin to approve it. */
export type PaymentStatus = "pending" | "awaiting" | "paid" | "failed" | "cancelled" | "rejected"

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
  /** "online" through SSLCommerz, or "manual": sent by hand, or months given by the super admin. */
  channel: "online" | "manual"
  months: number
  /** Sent by hand: the TrxID or bank reference, and the number or account it came from. */
  reference: string
  sentFrom: string
  /** The super admin's note, e.g. why it was rejected. */
  note: string
  reviewedAt: string | null
}

/** Where owners send money by hand. Set by the super admin. */
export interface PaymentAccounts {
  bkash: string
  nagad: string
  rocket: string
  bank: string
  contact: string
}

export interface BillingConfig {
  testGateway: boolean
  /** SSLCommerz is connected, or the test gateway is on. */
  online: boolean
  accounts: PaymentAccounts
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
  /** Quantity at each of the user's locations (location id -> quantity), on lists and details. */
  stock?: Record<string, number>
  /** Total across the user's locations. */
  total?: number
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
  /** Only when the list is asked for ?stats=1, for the clients page. */
  stats?: {
    activeRentals: number
    overdueRentals: number
    openOrders: number
    /** Paid, not refunded, at the user's locations. */
    lifetimeValue: number
  }
}

/** Who the business buys stock from. */
export interface Supplier {
  id: string
  name: string
  company?: string
  phone?: string
  email?: string
  address?: string
  createdAt: string
  /** Only when the list is asked for ?stats=1, for the suppliers page. At the user's locations. */
  stats?: {
    purchaseCount: number
    spent: number
    lastPurchaseAt: string | null
    /** Open returns: what they still owe back, as money or replacements. */
    owedBack: number
    /** What the business owes them. Owners and admins only. */
    owed?: number
  }
}

export type SupplierBrief = Pick<Supplier, "id" | "name" | "company">

/** One product on a purchase, at the price paid. productId is null once the product is deleted. */
export interface PurchaseItem {
  id: string
  productId: string | null
  productName: string
  quantity: number
  unitCost: number
  amount: number
  /** How many were sent back to the supplier. */
  returned: number
}

export type SupplierReturnStatus = "open" | "settled" | "closed"
export type RefundMethod = "cash" | "mobile" | "bank"

/**
 * Stock from a purchase sent back to the supplier (broken, damaged, wrong). It left
 * stock straight away; the supplier settles with replacements, a refund, or both.
 */
export interface SupplierReturn {
  id: string
  /** "SR-000003" */
  code: string
  purchaseId: string
  purchaseCode: string
  supplier: SupplierBrief | null
  locationId: string | null
  productId: string | null
  productName: string
  quantity: number
  /** What was paid for each on the purchase. */
  unitCost: number
  reason: string
  status: SupplierReturnStatus
  replacedQuantity: number
  refundedAmount: number
  /** Taken off what the business owes the supplier. */
  creditedAmount: number
  refundMethod: RefundMethod | ""
  closedNote: string
  /** quantity × unitCost */
  value: number
  /** What the supplier still owes, as money. */
  outstanding: number
  /** How many more units they can send instead. */
  unitsToReplace: number
  createdBy: string
  createdAt: string
  finishedAt: string | null
}

/** Stock bought in: one supplier's bill, received at one location. */
export interface Purchase {
  id: string
  /** "P-000012" */
  code: string
  /** Null when bought without a supplier on record. */
  supplier: SupplierBrief | null
  locationId: string | null
  /** The supplier's own bill or invoice number. */
  reference: string
  note: string
  purchasedAt: string
  createdBy: string
  createdAt: string
  items: PurchaseItem[]
  total: number
  /** Paid when bought plus later payments given to it. */
  paidAmount: number
  /** Still owed to the supplier. */
  due: number
  paymentStatus: PurchasePaymentStatus
  /** When the rest is due, for stock bought on credit. "YYYY-MM-DD". */
  dueDate: string | null
}

export type PurchasePaymentStatus = "paid" | "partly_paid" | "unpaid"
/** How a supplier was paid. "credit" is a return taken off what's owed; "" is from before payments were tracked. */
export type SupplierPaymentMethod = "cash" | "mobile" | "bank" | "credit"

/** Money paid to a supplier, given to their oldest unpaid bills first. */
export interface SupplierPayment {
  id: string
  /** "SP-000004" */
  code: string
  supplier: SupplierBrief | null
  amount: number
  method: SupplierPaymentMethod | ""
  paidAt: string
  note: string
  /** For a return credit: the return it came from. */
  returnCode: string | null
  createdBy: string
  createdAt: string
  /** Which bills it paid, and how much of each. */
  allocations: { purchaseId: string; purchaseCode: string; amount: number }[]
}

/** One line of a supplier's statement, newest first, with what was owed after it. */
export type StatementEntry = { id: string; code: string; at: string; amount: number; balance: number } & (
  | { kind: "purchase"; reference: string; dueDate: string | null; status: PurchasePaymentStatus }
  | { kind: "payment"; method: SupplierPaymentMethod | ""; note: string; returnCode: string | null }
)

export interface SupplierStatement {
  owed: number
  overdue: number
  entries: StatementEntry[]
}

/** The client shown on an order or rental. Null when the client was deleted. */
export type ClientBrief = Pick<Client, "id" | "name" | "company" | "phone" | "email" | "address">

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
  productName: string | null
  productUnit: string | null
  quantity: number
  /** Price per unit agreed when the order was placed. Null on orders from before sales tracking. */
  unitPrice: number | null
  clientId: string
  client: ClientBrief | null
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
  productName: string | null
  productUnit: string | null
  quantity: number
  clientId: string
  client: ClientBrief | null
  locationId: string
  startDate: string
  /** Expected days, optional: only for the due date. The price uses the actual days out. */
  days: number | null
  plan: RentalPlan
  /** Price per day/week/month, or the flat amount when plan is "fixed". */
  rate: number
  deposit: number
  total: number
  status: RentalStatus
  returnedAt?: string
  /** Set when it comes back: days it was out, and holidays taken off (per-day plan only). */
  daysOut: number | null
  holidays: number
  notes?: string
  createdAt: string
}

export type TransferStatus = "in_transit" | "received" | "cancelled"

export interface Transfer {
  id: string
  code: string
  productId: string
  productName: string | null
  productUnit: string | null
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
  userId: string | null
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
  clientName: string | null
  orderId: string | null
  rentalId: string | null
  soldBy: string
  soldAt: string
  /** Set when the goods came back; refunded sales don't count. */
  refundedAt: string | null
  refundedBy: string
  refundReason: string
  /** A manager asked for a return; the owner or an admin approves or declines it. */
  returnRequest: "" | "requested" | "declined"
  returnRequestedBy: string
  returnRequestedAt: string | null
  returnDeclineNote: string
  /** "" when not recorded (orders, older sales). */
  paymentMethod: PaymentMethod | ""
  /** The bKash / Nagad transaction ID, for mobile banking sales. */
  paymentReference: string
  /** "R-000123". */
  receiptNo: string | null
  /** For the buyer's public receipt link, /r/<token>. */
  receiptToken: string | null
  /** Only right after a checkout: every item sold with this one, this one first. */
  sales?: Sale[]
}

/** A paid sale as the buyer's receipt. The team's copy adds the fields marked "team". */
export interface Receipt {
  receiptNo: string
  businessName: string
  currency: string
  shop: { name: string; address: string; phone: string } | null
  soldAt: string
  channel: SaleChannel
  /** The order or rental code it came from, or "". */
  reference: string
  /** Phone and email on the team's copy only, for sending it. */
  client: { name: string; company: string; phone?: string; email?: string } | null
  /** Every item of the checkout; `returned` once that item came back. */
  items: { name: string; quantity: number; unitPrice: number; amount: number; returned: boolean }[]
  subtotal: number
  /** The discount on the whole bill. */
  discount: number
  total: number
  /** What went back to the buyer for returned items. */
  refunded: number
  paymentMethod: PaymentMethod | ""
  paymentLabel: string
  paymentReference: string
  /** Once every item came back. */
  refundedAt: string | null
  /** Team. */
  id?: string
  receiptToken?: string
  soldBy?: string
}

export type StockRequestStatus = "pending" | "approved" | "declined" | "cancelled"

/** A shop asking for stock. Approving it sends a transfer; `stage` follows that transfer. */
export interface StockRequest {
  id: string
  code: string
  productId: string | null
  productName: string | null
  productUnit: string | null
  quantity: number
  toLocationId: string | null
  note: string
  status: StockRequestStatus
  stage: StockRequestStatus | "in_transit" | "received"
  requestedBy: string
  requestedById: string | null
  createdAt: string
  decidedBy: string
  decidedAt: string | null
  decisionNote: string
  transferId: string | null
  fromLocationId: string | null
}

// ---------- Totals worked out by the server ----------

/** Stock across the user's locations: GET stock/summary/. */
export interface StockSummary {
  products: number
  units: number
  /** At cost. */
  value: number
  /** Products running low or out, by their total. */
  low: number
  out: number
  locations: { locationId: string; units: number; value: number; products: number; low: number }[]
}

/** Counts for the sidebar: GET overview/?only=badges. */
export interface Badges {
  overdueRentals: number
  openOrders: number
  waitingRequests: number
}

/** The dashboard: GET overview/. Sections are left out when the feature is off or not allowed. */
export interface Overview extends Badges {
  products: number
  units: number
  value: number
  unitsByLocation: Record<string, number>
  lowStockCount: number
  /** Out everywhere first (locationId null), then running low where it's kept. */
  lowStock: { productId: string; productName: string; locationId: string | null; quantity: number }[]
  activeRentals?: number
  overdueList?: Rental[]
  /** Orders still on their way, by status. */
  ordersByStatus?: { status: ShipmentStatus; count: number }[]
  recentActivity?: Activity[]
}

/** GET rentals/summary/. */
export interface RentalSummary {
  active: number
  activeUnits: number
  overdue: number
  /** What the rentals out now have run up so far. */
  running: number
  /** Total of returned rentals. */
  earned: number
}

/** GET shipments/counts/: orders in each status. */
export type ShipmentCounts = { status: ShipmentStatus; count: number }[]
