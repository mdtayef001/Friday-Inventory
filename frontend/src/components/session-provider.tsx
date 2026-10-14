"use client"

import { createContext, use, useMemo } from "react"
import { canAccess, hasPermission } from "@/lib/auth/roles"
import type { Business, PermissionId, SessionUser } from "@/lib/types"
import { useLocations } from "@/lib/data/queries"

const SessionContext = createContext<SessionUser | null>(null)
const BusinessContext = createContext<Business | null>(null)

export function SessionProvider({ user, business = null, children }: { user: SessionUser; business?: Business | null; children: React.ReactNode }) {
  return (
    <SessionContext value={user}>
      <BusinessContext value={business}>{children}</BusinessContext>
    </SessionContext>
  )
}

export function useSessionUser() {
  const user = use(SessionContext)
  if (!user) throw new Error("useSessionUser must be used inside <SessionProvider>")
  return user
}

/** The current user's business. Only use inside the business app, not /platform. */
export function useBusiness() {
  const business = use(BusinessContext)
  if (!business) throw new Error("useBusiness must be used inside a business session")
  return business
}

/** What the owner allows the current user to do. */
export function usePermissions() {
  const user = useSessionUser()
  const business = useBusiness()
  return useMemo(
    () => ({
      can: (permission: PermissionId) => hasPermission(user.role, permission, business.settings),
      canOpen: (path: string) => canAccess(user, path, business.settings),
      module: (id: keyof Business["settings"]["modules"]) => business.settings.modules[id],
      /** Owner/manager follow "managerProducts"; staff follow "staffCreateProducts". */
      canCreateProducts:
        user.canAddStock && hasPermission(user.role, user.role === "staff" ? "staffCreateProducts" : "managerProducts", business.settings),
      /** Per-person rights (always true for owners and managers). */
      canSell: user.canSell,
      canAddStock: user.canAddStock,
    }),
    [user, business],
  )
}

/**
 * Locations the current user may see and act on. Owners see every location;
 * managers and staff only see the ones assigned to them.
 */
export function useScope() {
  const user = useSessionUser()
  const locations = useLocations()
  return useMemo(() => {
    const isOwner = user.role === "owner"
    const allowed = isOwner ? locations : locations.filter((l) => user.locationIds.includes(l.id))
    const ids = new Set(allowed.map((l) => l.id))
    return { locations: allowed, has: (id: string) => ids.has(id), isOwner }
  }, [user, locations])
}
