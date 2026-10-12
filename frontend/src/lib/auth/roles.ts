// Route permissions. No server-only imports so proxy.ts and client
// components can share the same rules.
import type { BusinessSettings, ModuleId, PermissionId, Role, TenantRole } from "@/lib/types"

export const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Super admin",
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
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
}

const prefix = (p: string) => (path: string) => path === p || path.startsWith(p + "/")

/** First match wins. Anything not listed is owner/manager only. */
const ROUTE_RULES: Rule[] = [
  { test: prefix("/platform"), roles: ["superadmin"] },
  { test: prefix("/entry"), roles: TEAM },
  { test: prefix("/settings"), roles: ["owner"] },
  { test: prefix("/billing"), roles: ["owner"] },
  { test: prefix("/subscribe"), roles: ["owner"] },
  { test: prefix("/invoice"), roles: ["owner", "superadmin"] },
  { test: prefix("/activity"), roles: LEADS, permission: "managerActivity" },
  { test: prefix("/users"), roles: LEADS, permission: "managerUsers" },
  { test: (p) => p === "/products/new" || /^\/products\/[^/]+\/edit$/.test(p), roles: LEADS, permission: "managerProducts" },
  { test: prefix("/rentals"), roles: LEADS, module: "rentals" },
  { test: prefix("/tracking"), roles: LEADS, module: "tracking" },
  { test: prefix("/transfers"), roles: LEADS, module: "transfers" },
]

export const APP_ROUTES = [
  "/platform",
  "/dashboard",
  "/products",
  "/inventory",
  "/locations",
  "/transfers",
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
]

export function isAppRoute(path: string) {
  return APP_ROUTES.some((p) => prefix(p)(path))
}

/**
 * Can this user open this path? Without `settings` (in proxy.ts) only the
 * role is checked; pages pass the business settings for the full check.
 */
export function canAccess(user: { role: Role }, path: string, settings?: BusinessSettings) {
  const rule = ROUTE_RULES.find((r) => r.test(path))
  const roles = rule?.roles ?? LEADS
  if (!roles.includes(user.role)) return false
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

/** Which roles a user of `role` is allowed to create inside their business. */
export function creatableRoles(role: Role): TenantRole[] {
  if (role === "owner") return ["owner", "manager", "staff"]
  if (role === "manager") return ["staff"]
  return []
}
