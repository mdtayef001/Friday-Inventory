"use server"

import { z } from "zod"
import { api, toResult, type ActionResult } from "@/lib/api/server"
import type { ManagedUser } from "@/lib/types"
import { requireAccess } from "./dal"
import { creatableRoles } from "./roles"

// Server actions are public endpoints, so each one re-checks the caller here,
// and Django checks again: owners manage everyone in their business, managers
// only staff at their own locations, never across businesses.

export type { ActionResult }

export async function getManageableUsers(): Promise<ManagedUser[]> {
  await requireAccess("/users")
  return api<ManagedUser[]>("users/")
}

const CreateUserSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.email("Enter a valid email address").trim(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  role: z.enum(["owner", "manager", "staff"]),
  locationIds: z.array(z.string()).max(50),
})

export async function createUser(input: z.input<typeof CreateUserSchema>): Promise<ActionResult> {
  const { user: actor } = await requireAccess("/users")
  const parsed = CreateUserSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  if (!creatableRoles(actor.role).includes(parsed.data.role)) {
    return { ok: false, error: "You are not allowed to create this type of account." }
  }
  return toResult(() => api("users/", { method: "POST", body: parsed.data }))
}

const userPath = (id: string) => `users/${encodeURIComponent(id)}/`

export async function setUserActive(id: string, active: boolean) {
  await requireAccess("/users")
  if (typeof active !== "boolean") return { ok: false, error: "Invalid request." } as ActionResult
  return toResult(() => api(userPath(id), { method: "PATCH", body: { active } }))
}

export async function resetUserPassword(id: string, password: string): Promise<ActionResult> {
  await requireAccess("/users")
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return { ok: false, error: "Password must be at least 8 characters" }
  }
  return toResult(() => api(userPath(id), { method: "PATCH", body: { password } }))
}

export async function deleteUser(id: string) {
  await requireAccess("/users")
  return toResult(() => api(userPath(id), { method: "DELETE" }))
}
