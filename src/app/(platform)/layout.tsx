import { Suspense } from "react"
import { PlatformSidebar } from "@/components/platform-sidebar"
import { SessionProvider } from "@/components/session-provider"
import { PageSkeleton } from "@/components/store-gate"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { requireRole } from "@/lib/auth/dal"

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PlatformShell>{children}</PlatformShell>
    </Suspense>
  )
}

async function PlatformShell({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole(["superadmin"])
  return (
    <SessionProvider user={user}>
      <SidebarProvider>
        <PlatformSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-backdrop-filter:bg-background/60">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 h-4!" />
            <span className="truncate text-sm font-medium">Platform console</span>
          </header>
          <main className="flex-1">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </SessionProvider>
  )
}
