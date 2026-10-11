import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { ProductDetailView } from "./view"

export const metadata: Metadata = { title: "Product" }

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  await requireAccess("/products/[id]")
  const { id } = await params
  return <ProductDetailView id={id} />
}
