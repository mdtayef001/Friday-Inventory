import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { getManageableUsers } from "@/lib/auth/user-actions"
import { UsersView } from "./view"

export const metadata: Metadata = { title: "Users & Staff" }

export default async function UsersPage() {
  await requireRole(["admin", "manager"])
  const users = await getManageableUsers()
  return <UsersView users={users} />
}
