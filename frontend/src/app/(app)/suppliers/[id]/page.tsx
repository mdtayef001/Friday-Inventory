import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { SupplierDetailView } from "./view"

export const metadata: Metadata = { title: "Supplier" }

export default async function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  await requireAccess("/suppliers/[id]")
  const { id } = await params
  return <SupplierDetailView id={id} />
}
