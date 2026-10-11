import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { LocationsView } from "./view"

export const metadata: Metadata = { title: "Warehouses & Shops" }

export default async function LocationsPage() {
  await requireRole(["admin", "manager"])
  return <LocationsView />
}
