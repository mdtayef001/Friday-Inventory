import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { getManageableUsers } from "@/lib/auth/user-actions"
import { listUsers } from "@/lib/auth/users"
import { UsersView } from "./view"

export const metadata: Metadata = { title: "Users & Staff" }

export default async function UsersPage() {
  const { user } = await requireAccess("/users")
  const users = await getManageableUsers()
  return <UsersView users={users} teamSize={listUsers(user.tenantId).length} />
}
