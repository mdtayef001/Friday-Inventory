import { Suspense } from "react"
import { redirect } from "next/navigation"
import { AppHeader } from "@/components/app-header"
import { AppSidebar } from "@/components/app-sidebar"
import { SessionProvider } from "@/components/session-provider"
import { PageSkeleton, StoreGate } from "@/components/store-gate"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getCurrentUser } from "@/lib/auth/dal"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // The session is read at request time, so it streams in behind Suspense.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  )
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect("/logout")

  return (
    <SessionProvider user={user}>
      <StoreGate>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <AppHeader />
            <main className="flex-1">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </StoreGate>
    </SessionProvider>
  )
}
