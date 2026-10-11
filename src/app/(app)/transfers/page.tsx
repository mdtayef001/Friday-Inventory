import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { TransfersView } from "./view"

export const metadata: Metadata = { title: "Transfers" }

export default async function TransfersPage() {
  await requireRole(["admin", "manager"])
  return <TransfersView />
}
