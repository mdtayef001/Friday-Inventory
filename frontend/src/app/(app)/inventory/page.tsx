import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { InventoryView } from "./view"

export const metadata: Metadata = { title: "Stock Levels" }

export default async function InventoryPage() {
  await requireAccess("/inventory")
  return <InventoryView />
}
