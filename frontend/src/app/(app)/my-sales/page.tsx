import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { MySalesView } from "./view"

export const metadata: Metadata = { title: "My Sales" }

export default async function MySalesPage() {
  await requireAccess("/my-sales")
  return <MySalesView />
}
