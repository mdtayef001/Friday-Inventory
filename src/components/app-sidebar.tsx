"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowLeftRight,
  Boxes,
  CalendarClock,
  History,
  LayoutDashboard,
  Package,
  ScanBarcode,
  Settings,
  Store,
  Truck,
  UserCog,
  Users,
  Warehouse,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { isOverdue } from "@/lib/rental"
import { useStore } from "@/lib/store"
import { useBusiness, usePermissions, useScope, useSessionUser } from "./session-provider"
import { UserMenu } from "./user-menu"

const NAV = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/entry", label: "Quick Entry", icon: ScanBarcode },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: "/products", label: "Products", icon: Package },
      { href: "/inventory", label: "Stock Levels", icon: Boxes },
      { href: "/locations", label: "Warehouses & Shops", icon: Warehouse },
      { href: "/transfers", label: "Transfers", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Sales & Rentals",
    items: [
      { href: "/tracking", label: "Order Tracking", icon: Truck },
      { href: "/rentals", label: "Rentals", icon: CalendarClock },
      { href: "/clients", label: "Clients", icon: Users },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/users", label: "Users & Staff", icon: UserCog },
      { href: "/activity", label: "Activity Log", icon: History },
      { href: "/settings", label: "Business Settings", icon: Settings },
    ],
  },
]

export function AppSidebar() {
  const user = useSessionUser()
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const scope = useScope()
  const business = useBusiness()
  const { canOpen } = usePermissions()
  const overdue = useStore((s) => s.rentals.filter((r) => scope.has(r.locationId) && isOverdue(r)).length)
  const openShipments = useStore(
    (s) => s.shipments.filter((sh) => scope.has(sh.fromLocationId) && ["pending", "processing", "in_delivery"].includes(sh.status)).length,
  )
  const badges: Record<string, number> = { "/rentals": overdue, "/tracking": openShipments }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href={user.role === "staff" ? "/entry" : "/dashboard"} />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Store className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{business.name}</span>
                <span className="truncate text-xs text-muted-foreground">{business.status === "trial" ? "Free trial" : "Inventory Manager"}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => {
          const items = group.items.filter((item) => canOpen(item.href))
          if (items.length === 0) return null
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(item.href + "/")
                    const badge = badges[item.href]
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={active}
                          tooltip={item.label}
                          render={<Link href={item.href} onClick={() => setOpenMobile(false)} />}
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        {badge ? <SidebarMenuBadge>{badge}</SidebarMenuBadge> : null}
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
