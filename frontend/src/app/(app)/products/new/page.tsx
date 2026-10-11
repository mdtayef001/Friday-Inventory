import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { NewProductView } from "./view"

export const metadata: Metadata = { title: "Add product" }

export default async function NewProductPage() {
  await requireAccess("/products/new")
  return <NewProductView />
}
