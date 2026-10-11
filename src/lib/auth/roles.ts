// Route permissions. No server-only imports so proxy.ts and client
// components can share the same rules.
import type { Role } from "@/lib/types"

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
}

export const ROLE_HOME: Record<Role, string> = {
  admin: "/dashboard",
  manager: "/dashboard",
  staff: "/entry",
}

const ALL: Role[] = ["admin", "manager", "staff"]
const MANAGERS: Role[] = ["admin", "manager"]

/** First matching prefix wins. Anything not listed is admin/manager only. */
const ROUTE_RULES: [prefix: string, roles: Role[]][] = [
  ["/entry", ALL],
  ["/activity", ["admin"]],
]

export const APP_ROUTES = [
  "/dashboard",
  "/products",
  "/inventory",
  "/locations",
  "/transfers",
  "/tracking",
  "/rentals",
  "/clients",
  "/users",
  "/activity",
  "/entry",
]

function matches(path: string, prefix: string) {
  return path === prefix || path.startsWith(prefix + "/")
}

export function isAppRoute(path: string) {
  return APP_ROUTES.some((p) => matches(path, p))
}

export function rolesFor(path: string): Role[] {
  const rule = ROUTE_RULES.find(([prefix]) => matches(path, prefix))
  return rule ? rule[1] : MANAGERS
}

export function canAccess(role: Role, path: string) {
  return rolesFor(path).includes(role)
}

/** Which roles a user of `role` is allowed to create. */
export function creatableRoles(role: Role): Role[] {
  if (role === "admin") return ["admin", "manager", "staff"]
  if (role === "manager") return ["staff"]
  return []
}
