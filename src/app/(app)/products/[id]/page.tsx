import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { ProductDetailView } from "./view"

export const metadata: Metadata = { title: "Product" }

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  await requireRole(["admin", "manager"])
  const { id } = await params
  return <ProductDetailView id={id} />
}
