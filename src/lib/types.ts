// Shared domain types. These mirror the shapes the Django REST API will
// return later, so pages won't need to change when the backend lands.

export type Role = "admin" | "manager" | "staff"

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
  /** Locations this user works at. Empty for admins (they see everything). */
  locationIds: string[]
}

export interface ManagedUser extends SessionUser {
  active: boolean
  createdAt: string
  createdBy: string | null
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
  productId: string
  quantity: number
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
