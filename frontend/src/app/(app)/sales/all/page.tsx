import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { AllSalesView } from "./view"

export const metadata: Metadata = { title: "All sales" }

export default async function AllSalesPage() {
  await requireAccess("/sales")
  return <AllSalesView />
}
