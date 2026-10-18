import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { PurchasesView } from "./view"

export const metadata: Metadata = { title: "Purchases" }

export default async function PurchasesPage() {
  await requireAccess("/purchases")
  return <PurchasesView />
}
