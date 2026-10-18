import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { SupplierReturnsView } from "./view"

export const metadata: Metadata = { title: "Returns to Suppliers" }

export default async function SupplierReturnsPage() {
  await requireAccess("/supplier-returns")
  return <SupplierReturnsView />
}
