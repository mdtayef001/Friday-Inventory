import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { EntryView } from "./view"

export const metadata: Metadata = { title: "Quick Entry" }

export default async function EntryPage() {
  await requireAccess("/entry")
  return <EntryView />
}
