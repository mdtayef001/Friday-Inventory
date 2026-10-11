import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { ProductsView } from "./view"

export const metadata: Metadata = { title: "Products" }

export default async function ProductsPage() {
  await requireRole(["admin", "manager"])
  return <ProductsView />
}
