import { Suspense } from "react"
import { redirect } from "next/navigation"
import { AppHeader } from "@/components/app-header"
import { AppSidebar } from "@/components/app-sidebar"
import { SubscriptionBanner } from "@/components/billing"
import { CartProvider } from "@/components/cart"
import { SessionProvider } from "@/components/session-provider"
import { PageSkeleton, StoreGate } from "@/components/store-gate"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getContext } from "@/lib/auth/dal"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // The session is read at request time, so it streams in behind Suspense.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  )
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  const { user, business, locked } = ctx
  if (!business) redirect("/platform")
  if (locked) redirect("/subscribe")

  return (
    <SessionProvider user={user} business={business}>
      <StoreGate user={user} business={business}>
        <CartProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <AppHeader />
              <SubscriptionBanner />
              <main className="flex-1">{children}</main>
            </SidebarInset>
          </SidebarProvider>
        </CartProvider>
      </StoreGate>
    </SessionProvider>
  )
}
