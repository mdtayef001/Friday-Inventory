"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { CalendarClock, Factory, MapPin, Package, PackagePlus, ScanBarcode, Search, Truck, Users } from "lucide-react"
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
import { useClients, useDebounced, useProducts, usePurchases, useRentals, useShipments, useSuppliers } from "@/lib/data/queries"
import { usePermissions, useScope, useSessionUser } from "./session-provider"

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
  const { locations } = useScope()
  const { canOpen } = usePermissions()
  const [search, setSearch] = useState("")
  const term = useDebounced(search.trim())
  // The server searches, so only the best few matches come back. Only what this person can open.
  const on = (path: string) => open && !!term && canOpen(path)
  const products = useProducts({ page: 1, search: term }, { pageSize: 8, enabled: open && !!term })
  const clients = useClients({ page: 1, search: term }, { pageSize: 5, enabled: on("/clients") })
  const suppliers = useSuppliers({ page: 1, search: term }, { pageSize: 5, enabled: on("/suppliers") })
  const purchases = usePurchases({ page: 1, search: term }, { pageSize: 5, enabled: on("/purchases") })
  const orders = useShipments({ page: 1, search: term }, { pageSize: 5, enabled: on("/tracking") })
  const rentals = useRentals({ page: 1, search: term }, { pageSize: 5, enabled: on("/rentals") })
  const q = term.toLowerCase()
  const places = locations.filter((l) => !q || `${l.name} ${l.address}`.toLowerCase().includes(q))
  const searching = !!term && [products, clients, suppliers, purchases, orders, rentals].some((r) => r.isFetching)
  const found = <T,>(r: { data?: { results: T[] } }) => (term && r.data?.results.length ? r.data.results : null)
  const linked = (path: string, code: string) => `${path}?q=${encodeURIComponent(code)}`

  const go = (href: string) => {
    onOpenChange(false)
    setSearch("")
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Find products, clients, suppliers, purchases, orders, rentals and locations">
      <Command shouldFilter={false}>
        <CommandInput value={search} onValueChange={setSearch} placeholder="Search by name, SKU, barcode, client, P-000012…" />
        <CommandList>
          <CommandEmpty>{searching ? "Searching…" : "No results found."}</CommandEmpty>
          {found(products) && (
            <CommandGroup heading="Products">
              {found(products)!.map((p) => (
                <CommandItem key={p.id} value={`product-${p.id}`} onSelect={() => go(`/products/${p.id}`)}>
                  <Package />
                  <span className="truncate">{p.name}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{p.sku}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {found(clients) && (
            <CommandGroup heading="Clients">
              {found(clients)!.map((c) => (
                <CommandItem key={c.id} value={`client-${c.id}`} onSelect={() => go(linked("/clients", c.name))}>
                  <Users />
                  <span className="truncate">{c.name}</span>
                  {c.company && <span className="ml-auto text-xs text-muted-foreground">{c.company}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {found(suppliers) && (
            <CommandGroup heading="Suppliers">
              {found(suppliers)!.map((s) => (
                <CommandItem key={s.id} value={`supplier-${s.id}`} onSelect={() => go(`/suppliers/${s.id}`)}>
                  <Factory />
                  <span className="truncate">{s.name}</span>
                  {s.company && <span className="ml-auto text-xs text-muted-foreground">{s.company}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {found(purchases) && (
            <CommandGroup heading="Purchases">
              {found(purchases)!.map((p) => (
                <CommandItem key={p.id} value={`purchase-${p.id}`} onSelect={() => go(linked("/purchases", p.code))}>
                  <PackagePlus />
                  <span className="font-mono">{p.code}</span>
                  <span className="truncate text-muted-foreground">{p.supplier?.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{p.reference && `Bill ${p.reference}`}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {found(orders) && (
            <CommandGroup heading="Orders">
              {found(orders)!.map((o) => (
                <CommandItem key={o.id} value={`order-${o.id}`} onSelect={() => go(linked("/tracking", o.code))}>
                  <Truck />
                  <span className="font-mono">{o.code}</span>
                  <span className="truncate text-muted-foreground">{o.productName}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{o.client?.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {found(rentals) && (
            <CommandGroup heading="Rentals">
              {found(rentals)!.map((r) => (
                <CommandItem key={r.id} value={`rental-${r.id}`} onSelect={() => go(linked("/rentals", r.code))}>
                  <CalendarClock />
                  <span className="font-mono">{r.code}</span>
                  <span className="truncate text-muted-foreground">{r.productName}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{r.client?.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {places.length > 0 && (
            <CommandGroup heading="Locations">
              {places.map((l) => (
                <CommandItem key={l.id} value={`location-${l.id}`} onSelect={() => go(`/locations/${l.id}`)}>
                  <MapPin />
                  {l.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
