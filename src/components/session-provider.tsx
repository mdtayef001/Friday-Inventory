"use client"

import { createContext, use, useMemo } from "react"
import type { SessionUser } from "@/lib/types"
import { useStore } from "@/lib/store"

const SessionContext = createContext<SessionUser | null>(null)

export function SessionProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return <SessionContext value={user}>{children}</SessionContext>
}

export function useSessionUser() {
  const user = use(SessionContext)
  if (!user) throw new Error("useSessionUser must be used inside <SessionProvider>")
  return user
}

/**
 * Locations the current user may see and act on. Admins see every location;
 * managers and staff only see the ones assigned to them.
 */
export function useScope() {
  const user = useSessionUser()
  const locations = useStore((s) => s.locations)
  return useMemo(() => {
    const allowed = user.role === "admin" ? locations : locations.filter((l) => user.locationIds.includes(l.id))
    const ids = new Set(allowed.map((l) => l.id))
    return { locations: allowed, has: (id: string) => ids.has(id), isAdmin: user.role === "admin" }
  }, [user, locations])
}
