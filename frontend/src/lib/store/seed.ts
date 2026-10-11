import { subDays, subHours } from "date-fns"
import type {
  Activity,
  Client,
  Location,
  Product,
  Rental,
  Shipment,
  StockLevel,
  Transfer,
} from "@/lib/types"
import { quoteRental } from "@/lib/rental"

// Demo data so every screen has something to show. Dates are relative to the
// moment the store is first created, so overdue rentals etc. stay realistic.

export interface SeedData {
  locations: Location[]
  products: Product[]
  stock: StockLevel[]
  clients: Client[]
  shipments: Shipment[]
  rentals: Rental[]
  transfers: Transfer[]
  activity: Activity[]
}

export function createSeed(): SeedData {
  const now = new Date()
  const ago = (days: number) => subDays(now, days).toISOString()

  const locations: Location[] = [
    { id: "loc-main", name: "Main Warehouse", type: "warehouse", address: "12 Industrial Rd, Block C", phone: "+1 555 0100" },
    { id: "loc-downtown", name: "Downtown Outlet", type: "outlet", address: "88 Market Street", phone: "+1 555 0111" },
    { id: "loc-uptown", name: "Uptown Outlet", type: "outlet", address: "401 Park Avenue", phone: "+1 555 0122" },
    { id: "loc-airport", name: "Airport Kiosk", type: "outlet", address: "Terminal 2, Gate B", phone: "+1 555 0133" },
  ]

  const p = (
    id: string,
    name: string,
    category: string,
    sku: string,
    barcode: string,
    price: number,
    cost: number,
    extra: Partial<Product> = {},
  ): Product => ({
    id,
    name,
    category,
    sku,
    barcode,
    price,
    cost,
    unit: "pcs",
    lowStockThreshold: 5,
    rentable: false,
    createdAt: ago(60),
    createdBy: "Ayesha Rahman",
    ...extra,
  })

  const products: Product[] = [
    p("prd-1", "Wireless Barcode Scanner", "Electronics", "ELC-1001", "8901234567011", 89, 52),
    p("prd-2", "27\" 4K Monitor", "Electronics", "ELC-1002", "8901234567028", 349, 240, { lowStockThreshold: 3 }),
    p("prd-3", "Mechanical Keyboard", "Electronics", "ELC-1003", "8901234567035", 79, 41),
    p("prd-4", "Cordless Drill 20V", "Tools", "TLS-2001", "8901234567042", 129, 78, {
      rentable: true,
      rentRates: { daily: 12, weekly: 60, monthly: 180 },
    }),
    p("prd-5", "Pressure Washer", "Tools", "TLS-2002", "8901234567059", 299, 190, {
      rentable: true,
      rentRates: { daily: 25, weekly: 120, monthly: 380 },
      lowStockThreshold: 2,
    }),
    p("prd-6", "Steel Ladder 3m", "Tools", "TLS-2003", "8901234567066", 149, 90, {
      rentable: true,
      rentRates: { daily: 8, weekly: 40 },
    }),
    p("prd-7", "Office Chair Ergo", "Furniture", "FRN-3001", "8901234567073", 219, 130),
    p("prd-8", "Folding Table 6ft", "Furniture", "FRN-3002", "8901234567080", 89, 48, {
      rentable: true,
      rentRates: { daily: 6, weekly: 30 },
      lowStockThreshold: 10,
    }),
    p("prd-9", "Event Tent 3×6m", "Event Equipment", "EVT-4001", "8901234567097", 599, 380, {
      rentable: true,
      rentRates: { daily: 45, weekly: 220, monthly: 700 },
      lowStockThreshold: 2,
    }),
    p("prd-10", "PA Speaker System", "Event Equipment", "EVT-4002", "8901234567103", 899, 610, {
      rentable: true,
      rentRates: { daily: 60, weekly: 300 },
      lowStockThreshold: 2,
    }),
    p("prd-11", "Projector 1080p", "Electronics", "ELC-1004", "8901234567110", 459, 300, {
      rentable: true,
      rentRates: { daily: 30, weekly: 150, monthly: 450 },
      lowStockThreshold: 3,
    }),
    p("prd-12", "A4 Copy Paper (Box)", "Office Supplies", "OFS-5001", "8901234567127", 32, 21, { unit: "box", lowStockThreshold: 20 }),
    p("prd-13", "Thermal Label Roll", "Office Supplies", "OFS-5002", "8901234567134", 9, 4, { unit: "roll", lowStockThreshold: 30 }),
    p("prd-14", "Safety Helmet", "Safety", "SFT-6001", "8901234567141", 24, 11, { lowStockThreshold: 15 }),
  ]

  const s = (productId: string, quantities: [main: number, downtown: number, uptown: number, airport: number]) =>
    locations.map((loc, i) => ({ productId, locationId: loc.id, quantity: quantities[i] }))

  const stock: StockLevel[] = [
    ...s("prd-1", [40, 6, 4, 2]),
    ...s("prd-2", [12, 2, 1, 0]),
    ...s("prd-3", [55, 9, 7, 5]),
    ...s("prd-4", [18, 4, 3, 0]),
    ...s("prd-5", [6, 1, 0, 0]),
    ...s("prd-6", [10, 2, 2, 0]),
    ...s("prd-7", [24, 3, 5, 0]),
    ...s("prd-8", [60, 8, 4, 0]),
    ...s("prd-9", [5, 1, 0, 0]),
    ...s("prd-10", [3, 1, 1, 0]),
    ...s("prd-11", [9, 2, 1, 1]),
    ...s("prd-12", [150, 18, 12, 6]),
    ...s("prd-13", [400, 25, 20, 8]),
    ...s("prd-14", [12, 3, 2, 0]),
  ].filter((row) => row.quantity > 0)

  const clients: Client[] = [
    { id: "cl-1", name: "Rafi Ahmed", company: "BrightBuild Co.", phone: "+1 555 0201", email: "rafi@brightbuild.co", address: "5 Lake View", createdAt: ago(50) },
    { id: "cl-2", name: "Sara Khan", company: "Bloom Events", phone: "+1 555 0202", email: "sara@bloomevents.com", address: "77 Garden Lane", createdAt: ago(45) },
    { id: "cl-3", name: "Tanvir Chowdhury", company: "TechNest Ltd.", phone: "+1 555 0203", email: "tanvir@technest.io", address: "9 Silicon Ave", createdAt: ago(40) },
    { id: "cl-4", name: "Mim Akter", phone: "+1 555 0204", email: "mim.akter@mail.com", address: "21 River Road", createdAt: ago(20) },
    { id: "cl-5", name: "Jamal Uddin", company: "Uddin Interiors", phone: "+1 555 0205", email: "jamal@uddininteriors.com", address: "3 Oak Street", createdAt: ago(12) },
  ]

  const ship = (
    id: string,
    code: string,
    productId: string,
    quantity: number,
    clientId: string,
    fromLocationId: string,
    path: Shipment["status"][],
    startedDaysAgo: number,
  ): Shipment => ({
    id,
    code,
    productId,
    quantity,
    clientId,
    fromLocationId,
    status: path[path.length - 1],
    createdAt: ago(startedDaysAgo),
    history: path.map((status, i) => ({
      status,
      at: subHours(subDays(now, startedDaysAgo), -i * 20).toISOString(),
      by: "Karim Hasan",
    })),
  })

  const shipments: Shipment[] = [
    ship("sh-1", "SHP-7A21C4", "prd-2", 4, "cl-3", "loc-main", ["pending", "processing", "in_delivery"], 2),
    ship("sh-2", "SHP-19BD02", "prd-7", 10, "cl-5", "loc-main", ["pending", "processing", "in_delivery", "delivered"], 6),
    ship("sh-3", "SHP-C4E911", "prd-12", 25, "cl-1", "loc-downtown", ["pending"], 0),
    ship("sh-4", "SHP-5F0A3B", "prd-3", 8, "cl-3", "loc-uptown", ["pending", "processing"], 1),
    ship("sh-5", "SHP-88D3E0", "prd-1", 2, "cl-4", "loc-downtown", ["pending", "processing", "in_delivery", "delivered", "returned"], 10),
  ]

  const rent = (
    id: string,
    code: string,
    productId: string,
    quantity: number,
    clientId: string,
    locationId: string,
    plan: Rental["plan"],
    rate: number,
    days: number,
    startedDaysAgo: number,
    status: Rental["status"] = "active",
  ): Rental => ({
    id,
    code,
    productId,
    quantity,
    clientId,
    locationId,
    plan,
    rate,
    days,
    deposit: Math.round(rate * 2),
    total: quoteRental(plan, rate, days, quantity).total,
    startDate: ago(startedDaysAgo),
    status,
    returnedAt: status === "returned" ? ago(startedDaysAgo - days) : undefined,
    createdAt: ago(startedDaysAgo),
  })

  const rentals: Rental[] = [
    rent("rn-1", "RNT-3B7E10", "prd-9", 1, "cl-2", "loc-main", "daily", 45, 3, 1),
    rent("rn-2", "RNT-A0C6F2", "prd-10", 1, "cl-2", "loc-downtown", "weekly", 300, 7, 9),
    rent("rn-3", "RNT-61E9D8", "prd-4", 2, "cl-1", "loc-uptown", "weekly", 60, 14, 5),
    rent("rn-4", "RNT-F24B55", "prd-8", 12, "cl-2", "loc-main", "fixed", 150, 2, 20, "returned"),
    rent("rn-5", "RNT-0D93AA", "prd-11", 1, "cl-3", "loc-main", "monthly", 450, 30, 4),
  ]

  const transfers: Transfer[] = [
    { id: "tr-1", code: "TRF-2C81E7", productId: "prd-3", quantity: 10, fromLocationId: "loc-main", toLocationId: "loc-airport", status: "in_transit", createdAt: ago(1), createdBy: "Karim Hasan" },
    { id: "tr-2", code: "TRF-B9F004", productId: "prd-12", quantity: 20, fromLocationId: "loc-main", toLocationId: "loc-downtown", status: "received", createdAt: ago(8), createdBy: "Ayesha Rahman", receivedAt: ago(7) },
  ]

  const activity: Activity[] = [
    { id: "ac-1", at: subHours(now, 1).toISOString(), user: "Nadia Islam", action: "Stock added", detail: "+20 Thermal Label Roll at Main Warehouse" },
    { id: "ac-2", at: subHours(now, 5).toISOString(), user: "Karim Hasan", action: "Shipment created", detail: "SHP-C4E911 · 25 × A4 Copy Paper (Box) to Rafi Ahmed" },
    { id: "ac-3", at: ago(1), user: "Karim Hasan", action: "Transfer started", detail: "TRF-2C81E7 · 10 × Mechanical Keyboard → Airport Kiosk" },
    { id: "ac-4", at: ago(1), user: "Ayesha Rahman", action: "Rental created", detail: "RNT-3B7E10 · Event Tent 3×6m to Sara Khan" },
    { id: "ac-5", at: ago(4), user: "Ayesha Rahman", action: "Rental created", detail: "RNT-0D93AA · Projector 1080p to Tanvir Chowdhury" },
  ]

  return { locations, products, stock, clients, shipments, rentals, transfers, activity }
}

/** A brand-new business starts with one shop and nothing else. */
export function createEmpty(): SeedData {
  return {
    locations: [{ id: "loc-main", name: "Main Store", type: "outlet", address: "Add your address in Warehouses & Shops" }],
    products: [],
    stock: [],
    clients: [],
    shipments: [],
    rentals: [],
    transfers: [],
    activity: [],
  }
}
