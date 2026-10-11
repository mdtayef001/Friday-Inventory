import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { NewProductView } from "./view"

export const metadata: Metadata = { title: "Add product" }

export default async function NewProductPage() {
  await requireRole(["admin", "manager"])
  return <NewProductView />
}
