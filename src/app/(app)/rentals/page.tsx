import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { RentalsView } from "./view"

export const metadata: Metadata = { title: "Rentals" }

export default async function RentalsPage() {
  await requireRole(["admin", "manager"])
  return <RentalsView />
}
