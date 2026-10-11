"use server"

import { refresh } from "next/cache"
import { z } from "zod"
import type { ManagedUser, SessionUser } from "@/lib/types"
import { requireRole } from "./dal"
import { creatableRoles } from "./roles"
import { emailTaken, findUserById, insertUser, listUsers, patchUser, removeUser } from "./users"

// Every action re-checks the caller's role on the server. Server actions are
// public endpoints, so the UI hiding a button is never enough.

export type ActionResult = { ok: true } | { ok: false; error: string }

/** Admins manage everyone; managers only manage staff at their own locations. */
function canManage(actor: SessionUser, target: ManagedUser) {
  if (actor.id === target.id) return false
  if (actor.role === "admin") return true
  return (
    actor.role === "manager" &&
    target.role === "staff" &&
    target.locationIds.some((id) => actor.locationIds.includes(id))
  )
}

export async function getManageableUsers(): Promise<ManagedUser[]> {
  const actor = await requireRole(["admin", "manager"])
  return listUsers().filter((u) => u.id === actor.id || canManage(actor, u))
}

const CreateUserSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.email("Enter a valid email address").trim(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  role: z.enum(["admin", "manager", "staff"]),
  locationIds: z.array(z.string()).max(50),
})

export async function createUser(input: z.input<typeof CreateUserSchema>): Promise<ActionResult> {
  const actor = await requireRole(["admin", "manager"])
  const parsed = CreateUserSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  const data = parsed.data

  if (!creatableRoles(actor.role).includes(data.role)) {
    return { ok: false, error: "You are not allowed to create this type of account." }
  }
  if (data.role !== "admin" && data.locationIds.length === 0) {
    return { ok: false, error: "Assign at least one location." }
  }
  if (actor.role === "manager" && !data.locationIds.every((id) => actor.locationIds.includes(id))) {
    return { ok: false, error: "You can only assign your own locations." }
  }
  if (emailTaken(data.email)) return { ok: false, error: "An account with this email already exists." }

  insertUser({ ...data, createdBy: actor.id })
  refresh()
  return { ok: true }
}

async function withTarget(id: string, fn: (target: ManagedUser) => void): Promise<ActionResult> {
  const actor = await requireRole(["admin", "manager"])
  const target = findUserById(id)
  if (!target || !canManage(actor, target)) {
    return { ok: false, error: "You can't change this account." }
  }
  fn(target)
  refresh()
  return { ok: true }
}

export async function setUserActive(id: string, active: boolean) {
  return withTarget(id, () => patchUser(id, { active }))
}

export async function resetUserPassword(id: string, password: string): Promise<ActionResult> {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return { ok: false, error: "Password must be at least 8 characters" }
  }
  return withTarget(id, () => patchUser(id, { password }))
}

export async function deleteUser(id: string) {
  return withTarget(id, () => removeUser(id))
}
