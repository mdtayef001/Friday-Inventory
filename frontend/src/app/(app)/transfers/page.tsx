import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { TransfersView } from "./view"

export const metadata: Metadata = { title: "Transfers" }

export default async function TransfersPage() {
  await requireAccess("/transfers")
  return <TransfersView />
}
