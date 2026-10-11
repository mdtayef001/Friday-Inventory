import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { EditProductView } from "./view"

export const metadata: Metadata = { title: "Edit product" }

export default async function EditProductPage({ params }: PageProps<"/products/[id]/edit">) {
  await requireAccess("/products/[id]/edit")
  const { id } = await params
  return <EditProductView id={id} />
}
