import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { RentalsView } from "./view"

export const metadata: Metadata = { title: "Rentals" }

export default async function RentalsPage() {
  await requireAccess("/rentals")
  return <RentalsView />
}
