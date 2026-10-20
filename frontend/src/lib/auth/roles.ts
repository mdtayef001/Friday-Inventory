// Route permissions. No server-only imports so proxy.ts and client
// components can share the same rules.
import type { BusinessSettings, ModuleId, PermissionId, Role, SessionUser, TenantRole } from "@/lib/types"

export const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Super admin",
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
}

/** "Owner" for the business's Owner, "Admin" for any other owner-level account. */
export function roleLabel(user: Pick<SessionUser, "role" | "isMainOwner">) {
  return user.role === "owner" && !user.isMainOwner ? "Admin" : ROLE_LABEL[user.role]
}

export const ROLE_HOME: Record<Role, string> = {
  superadmin: "/platform",
  owner: "/dashboard",
  manager: "/dashboard",
  staff: "/entry",
}

const TEAM: Role[] = ["owner", "manager", "staff"]
const LEADS: Role[] = ["owner", "manager"]

interface Rule {
  test: (path: string) => boolean
  roles: Role[]
  /** Route is hidden when the owner switches this feature off. */
  module?: ModuleId
  /** Managers need this permission from the owner. */
  permission?: PermissionId
  /** Staff need this per-person right (always true for owners and managers). */
  right?: "canRent"
}

const prefix = (p: string) => (path: string) => path === p || path.startsWith(p + "/")

/** First match wins. Anything not listed is owner/manager only. */
const ROUTE_RULES: Rule[] = [
  { test: prefix("/platform"), roles: ["superadmin"] },
  { test: prefix("/entry"), roles: TEAM },
  { test: prefix("/my-sales"), roles: TEAM },
  { test: prefix("/settings"), roles: ["owner"] },
  { test: prefix("/billing"), roles: ["owner"] },
  { test: prefix("/subscribe"), roles: ["owner"] },
  { test: prefix("/invoice"), roles: ["owner", "superadmin"] },
  { test: prefix("/activity"), roles: LEADS, permission: "managerActivity" },
  { test: prefix("/users"), roles: LEADS, permission: "managerUsers" },
  { test: (p) => p === "/products/new" || /^\/products\/[^/]+\/edit$/.test(p), roles: LEADS, permission: "managerProducts" },
  { test: prefix("/rentals"), roles: TEAM, module: "rentals", right: "canRent" },
  { test: prefix("/tracking"), roles: LEADS, module: "tracking" },
  { test: prefix("/transfers"), roles: LEADS, module: "transfers" },
  { test: prefix("/purchases"), roles: LEADS, permission: "managerPurchases" },
  { test: prefix("/suppliers"), roles: LEADS, permission: "managerPurchases" },
  { test: prefix("/supplier-returns"), roles: LEADS, permission: "managerPurchases" },
]

export const APP_ROUTES = [
  "/platform",
  "/dashboard",
  "/products",
  "/inventory",
  "/locations",
  "/transfers",
  "/purchases",
  "/suppliers",
  "/supplier-returns",
  "/tracking",
  "/rentals",
  "/clients",
  "/sales",
  "/users",
  "/activity",
  "/settings",
  "/billing",
  "/subscribe",
  "/invoice",
  "/entry",
  "/my-sales",
]

export function isAppRoute(path: string) {
  return APP_ROUTES.some((p) => prefix(p)(path))
}

/**
 * Can this user open this path? Without `settings` (in proxy.ts) only the
 * role is checked; pages pass the business settings for the full check.
 */
export function canAccess(user: { role: Role; canRent?: boolean }, path: string, settings?: BusinessSettings) {
  const rule = ROUTE_RULES.find((r) => r.test(path))
  const roles = rule?.roles ?? LEADS
  if (!roles.includes(user.role)) return false
  if (rule?.right && user[rule.right] === false) return false
  if (!settings || !rule) return true
  if (rule.module && !settings.modules[rule.module]) return false
  if (rule.permission && user.role === "manager" && !settings.permissions[rule.permission]) return false
  return true
}

/** Owners can do everything in their business; others need the owner's permission. */
export function hasPermission(role: Role, permission: PermissionId, settings: BusinessSettings) {
  if (role === "owner") return true
  const needs = permission.startsWith("staff") ? "staff" : "manager"
  return role === needs && settings.permissions[permission]
}

/**
 * Which roles `user` may give. Only the Owner makes admins ("owner" accounts after the first);
 * admins make managers and staff, managers make staff. Same rules as Django.
 */
export function creatableRoles(user: Pick<SessionUser, "role" | "isMainOwner">): TenantRole[] {
  if (user.role === "owner") return user.isMainOwner ? ["owner", "manager", "staff"] : ["manager", "staff"]
  if (user.role === "manager") return ["staff"]
  return []
}

/** Whether `actor` may edit, disable or delete `user`: nobody changes themselves or the Owner, and only the Owner changes admins. */
export function canManageUser(actor: Pick<SessionUser, "id" | "isMainOwner">, user: Pick<SessionUser, "id" | "role" | "isMainOwner">) {
  if (actor.id === user.id || user.isMainOwner) return false
  return user.role !== "owner" || actor.isMainOwner
}
