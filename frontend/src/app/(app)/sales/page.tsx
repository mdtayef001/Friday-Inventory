import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { SalesView } from "./view"

export const metadata: Metadata = { title: "Sales" }

export default async function SalesPage() {
  await requireAccess("/sales")
  return <SalesView />
}
