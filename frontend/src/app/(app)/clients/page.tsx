import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { ClientsView } from "./view"

export const metadata: Metadata = { title: "Clients" }

export default async function ClientsPage() {
  await requireAccess("/clients")
  return <ClientsView />
}
