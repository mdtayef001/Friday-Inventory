import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { EditProductView } from "./view"

export const metadata: Metadata = { title: "Edit product" }

export default async function EditProductPage({ params }: PageProps<"/products/[id]/edit">) {
  await requireRole(["admin", "manager"])
  const { id } = await params
  return <EditProductView id={id} />
}
