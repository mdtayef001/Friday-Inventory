import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { LocationsView } from "./view"

export const metadata: Metadata = { title: "Warehouses & Shops" }

export default async function LocationsPage() {
  await requireAccess("/locations")
  return <LocationsView />
}
