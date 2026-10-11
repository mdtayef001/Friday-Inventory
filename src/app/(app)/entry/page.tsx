import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { EntryView } from "./view"

export const metadata: Metadata = { title: "Quick Entry" }

export default async function EntryPage() {
  await requireRole(["admin", "manager", "staff"])
  return <EntryView />
}
