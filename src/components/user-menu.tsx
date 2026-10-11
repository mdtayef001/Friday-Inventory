"use client"

import { useTransition } from "react"
import { ChevronsUpDown, LogOut, MapPin, Moon, RotateCcw, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { logout } from "@/lib/auth/actions"
import { ROLE_LABEL } from "@/lib/auth/roles"
import { useStore } from "@/lib/store"
import { useScope, useSessionUser } from "./session-provider"

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export function UserMenu() {
  const user = useSessionUser()
  const scope = useScope()
  const { resolvedTheme, setTheme } = useTheme()
  const resetDemoData = useStore((s) => s.resetDemoData)
  const [pending, startTransition] = useTransition()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}>
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg bg-primary/10 text-primary">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="font-medium text-foreground">{user.name}</div>
                <div className="text-xs font-normal">{user.email}</div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {!scope.isAdmin && (
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex items-start gap-2 text-xs font-normal">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" />
                  {scope.locations.map((l) => l.name).join(", ") || "No locations assigned"}
                </DropdownMenuLabel>
              </DropdownMenuGroup>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              {resolvedTheme === "dark" ? <Sun /> : <Moon />}
              {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
            {user.role === "admin" && (
              <DropdownMenuItem
                onClick={() => {
                  resetDemoData()
                  toast.success("Demo data restored")
                }}
              >
                <RotateCcw />
                Reset demo data
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={pending} onClick={() => startTransition(() => logout())}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
