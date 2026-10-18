"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowLeftRight,
  Boxes,
  CalendarClock,
  CreditCard,
  Factory,
  HandCoins,
  History,
  LayoutDashboard,
  Package,
  PackagePlus,
  PackageX,
  Receipt,
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
import { useBadges } from "@/lib/data/queries"
import { useBusiness, usePermissions, useSessionUser } from "./session-provider"
import { UserMenu } from "./user-menu"

const NAV = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/entry", label: "Quick Entry", icon: ScanBarcode },
      { href: "/my-sales", label: "My Sales", icon: HandCoins },
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
    label: "Buying",
    items: [
      { href: "/purchases", label: "Purchases", icon: PackagePlus },
      { href: "/supplier-returns", label: "Returns to Suppliers", icon: PackageX },
      { href: "/suppliers", label: "Suppliers", icon: Factory },
    ],
  },
  {
    label: "Sales & Rentals",
    items: [
      { href: "/sales", label: "Sales", icon: Receipt },
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
      { href: "/billing", label: "Billing", icon: CreditCard },
    ],
  },
]

export function AppSidebar() {
  const user = useSessionUser()
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const business = useBusiness()
  const { canOpen } = usePermissions()
  // Overdue rentals, orders in progress, and requests waiting for someone else to approve.
  const counts = useBadges()
  const badges: Record<string, number | undefined> = {
    "/rentals": counts?.overdueRentals,
    "/tracking": counts?.openOrders,
    "/transfers": counts?.waitingRequests,
  }

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
