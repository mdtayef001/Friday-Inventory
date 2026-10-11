import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { ProductsView } from "./view"

export const metadata: Metadata = { title: "Products" }

export default async function ProductsPage() {
  await requireAccess("/products")
  return <ProductsView />
}
