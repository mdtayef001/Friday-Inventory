import "server-only"
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto"
import type { ManagedUser, Role } from "@/lib/types"
import { DEMO_TENANT_ID } from "./tenants"

// Temporary in-memory user store for the frontend test. It resets when the
// dev server restarts. The Django backend will replace this module.

interface StoredUser extends ManagedUser {
  passwordHash: string
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":")
  const expected = Buffer.from(hash, "hex")
  const actual = scryptSync(password, salt, 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function seed(): Map<string, StoredUser> {
  const now = new Date().toISOString()
  const users: (Omit<StoredUser, "passwordHash" | "createdAt" | "active" | "createdBy"> & {
    password: string
  })[] = [
    { id: "u-super", name: "Platform Admin", email: "super@friday.app", role: "superadmin", tenantId: null, locationIds: [], password: "super123" },
    { id: "u-owner", name: "Ayesha Rahman", email: "owner@friday.app", role: "owner", tenantId: DEMO_TENANT_ID, locationIds: [], password: "owner123" },
    { id: "u-manager", name: "Karim Hasan", email: "manager@friday.app", role: "manager", tenantId: DEMO_TENANT_ID, locationIds: ["loc-downtown", "loc-uptown"], password: "manager123" },
    { id: "u-staff", name: "Nadia Islam", email: "staff@friday.app", role: "staff", tenantId: DEMO_TENANT_ID, locationIds: ["loc-main"], password: "staff123" },
    { id: "u-cafe", name: "Sara Khan", email: "cafe@friday.app", role: "owner", tenantId: "b-greenleaf", locationIds: [], password: "cafe1234" },
    { id: "u-urban", name: "Jamal Uddin", email: "urban@friday.app", role: "owner", tenantId: "b-urban", locationIds: [], password: "urban123" },
  ]
  return new Map(
    users.map(({ password, ...u }) => [
      u.id,
      { ...u, active: true, createdAt: now, createdBy: null, passwordHash: hashPassword(password) },
    ]),
  )
}

// Keep one store across hot reloads in development.
const globalStore = globalThis as unknown as { __fridayUsers?: Map<string, StoredUser> }
const store = (globalStore.__fridayUsers ??= seed())

function toPublic(stored: StoredUser): ManagedUser {
  const { passwordHash, ...user } = stored
  void passwordHash
  return user
}

export function findUserById(id: string): ManagedUser | null {
  const user = store.get(id)
  return user ? toPublic(user) : null
}

export function authenticate(email: string, password: string): ManagedUser | null {
  const user = [...store.values()].find((u) => u.email === email.toLowerCase())
  // Hash even when the email is unknown so response time doesn't reveal which emails exist.
  const ok = verifyPassword(password, user?.passwordHash ?? hashPassword("dummy-password"))
  if (!user || !ok || !user.active) return null
  return toPublic(user)
}

/** Users of one business, or everyone when `tenantId` is undefined. */
export function listUsers(tenantId?: string | null): ManagedUser[] {
  return [...store.values()]
    .filter((u) => tenantId === undefined || u.tenantId === tenantId)
    .map(toPublic)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function markLogin(id: string) {
  const user = store.get(id)
  if (user) user.lastLoginAt = new Date().toISOString()
}

export function removeTenantUsers(tenantId: string) {
  for (const [id, u] of store) if (u.tenantId === tenantId) store.delete(id)
}

export function emailTaken(email: string) {
  return [...store.values()].some((u) => u.email === email.toLowerCase())
}

export function insertUser(input: {
  name: string
  email: string
  password: string
  role: Role
  tenantId: string | null
  locationIds: string[]
  createdBy: string
}): ManagedUser {
  const user: StoredUser = {
    id: `u-${randomUUID().slice(0, 8)}`,
    name: input.name,
    email: input.email.toLowerCase(),
    role: input.role,
    tenantId: input.tenantId,
    locationIds: input.role === "owner" || input.role === "superadmin" ? [] : input.locationIds,
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    passwordHash: hashPassword(input.password),
  }
  store.set(user.id, user)
  return toPublic(user)
}

export function patchUser(id: string, patch: { active?: boolean; password?: string }) {
  const user = store.get(id)
  if (!user) return null
  if (patch.active !== undefined) user.active = patch.active
  if (patch.password) user.passwordHash = hashPassword(patch.password)
  return toPublic(user)
}

export function removeUser(id: string) {
  return store.delete(id)
}
