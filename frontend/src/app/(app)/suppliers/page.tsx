import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { SuppliersView } from "./view"

export const metadata: Metadata = { title: "Suppliers" }

export default async function SuppliersPage() {
  await requireAccess("/suppliers")
  return <SuppliersView />
}
