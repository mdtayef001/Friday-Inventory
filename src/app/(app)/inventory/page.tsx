import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { InventoryView } from "./view"

export const metadata: Metadata = { title: "Stock Levels" }

export default async function InventoryPage() {
  await requireRole(["admin", "manager"])
  return <InventoryView />
}
