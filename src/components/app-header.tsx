"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { MapPin, Package, ScanBarcode, Search, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useStore } from "@/lib/store"
import { useScope, useSessionUser } from "./session-provider"

const TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  entry: "Quick Entry",
  products: "Products",
  inventory: "Stock Levels",
  locations: "Warehouses & Shops",
  transfers: "Transfers",
  tracking: "Order Tracking",
  rentals: "Rentals",
  clients: "Clients",
  users: "Users & Staff",
  activity: "Activity Log",
  settings: "Business Settings",
  billing: "Billing",
}

export function AppHeader() {
  const pathname = usePathname()
  const user = useSessionUser()
  const [open, setOpen] = useState(false)
  const section = TITLES[pathname.split("/")[1]] ?? ""
  const isStaff = user.role === "staff"

  useEffect(() => {
    if (isStaff) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isStaff])

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-backdrop-filter:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4!" />
      <span className="truncate text-sm font-medium">{section}</span>
      <div className="ml-auto flex items-center gap-2">
        {!isStaff && (
          <>
            <Button
              variant="outline"
              className="w-9 justify-start gap-2 px-2.5 text-muted-foreground sm:w-56"
              onClick={() => setOpen(true)}
            >
              <Search />
              <span className="hidden sm:inline">Search…</span>
              <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
            </Button>
            <Button render={<Link href="/entry" />} nativeButton={false}>
              <ScanBarcode />
              <span className="hidden sm:inline">Scan / Add</span>
            </Button>
          </>
        )}
      </div>
      {!isStaff && <GlobalSearch open={open} onOpenChange={setOpen} />}
    </header>
  )
}

function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const products = useStore((s) => s.products)
  const clients = useStore((s) => s.clients)
  const { locations } = useScope()

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Find products, clients and locations">
      <Command>
        <CommandInput placeholder="Search by name, SKU, barcode, client…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Products">
            {products.map((p) => (
              <CommandItem key={p.id} value={`${p.name} ${p.sku} ${p.barcode ?? ""}`} onSelect={() => go(`/products/${p.id}`)}>
                <Package />
                <span className="truncate">{p.name}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{p.sku}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Clients">
            {clients.map((c) => (
              <CommandItem key={c.id} value={`${c.name} ${c.company ?? ""} ${c.phone ?? ""}`} onSelect={() => go(`/clients?q=${encodeURIComponent(c.name)}`)}>
                <Users />
                <span className="truncate">{c.name}</span>
                {c.company && <span className="ml-auto text-xs text-muted-foreground">{c.company}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Locations">
            {locations.map((l) => (
              <CommandItem key={l.id} value={`${l.name} ${l.address}`} onSelect={() => go(`/locations/${l.id}`)}>
                <MapPin />
                {l.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
