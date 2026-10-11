import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { ClientsView } from "./view"

export const metadata: Metadata = { title: "Clients" }

export default async function ClientsPage() {
  await requireRole(["admin", "manager"])
  return <ClientsView />
}
