"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Mail, Pencil, Phone, Plus, Search, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { attempt, ConfirmAction, EmptyState, PageBody, PageHeader, Pill } from "@/components/common"
import { ClientDialog } from "@/components/client-dialog"
import { initials } from "@/components/user-menu"
import { formatMoney } from "@/lib/format"
import { isOverdue } from "@/lib/rental"
import { useStore } from "@/lib/store"
import type { Client } from "@/lib/types"

export function ClientsView() {
  const params = useSearchParams()
  const clients = useStore((s) => s.clients)
  const rentals = useStore((s) => s.rentals)
  const shipments = useStore((s) => s.shipments)
  const products = useStore((s) => s.products)
  const deleteClient = useStore((s) => s.deleteClient)
  const [query, setQuery] = useState(params.get("q") ?? "")
  const [editing, setEditing] = useState<Client | "new" | null>(null)

  const summary = useMemo(() => {
    const price = new Map(products.map((p) => [p.id, p.price]))
    const map = new Map<string, { rentals: number; overdue: number; orders: number; value: number }>()
    const get = (id: string) => map.get(id) ?? map.set(id, { rentals: 0, overdue: 0, orders: 0, value: 0 }).get(id)!
    for (const r of rentals) {
      const s = get(r.clientId)
      if (r.status === "active") s.rentals++
      if (isOverdue(r)) s.overdue++
      s.value += r.total
    }
    for (const sh of shipments) {
      const s = get(sh.clientId)
      if (["pending", "processing", "in_delivery"].includes(sh.status)) s.orders++
      if (sh.status === "delivered") s.value += sh.quantity * (price.get(sh.productId) ?? 0)
    }
    return map
  }, [rentals, shipments, products])

  const q = query.trim().toLowerCase()
  const rows = clients.filter((c) => !q || [c.name, c.company, c.phone, c.email].some((v) => v?.toLowerCase().includes(q)))

  return (
    <PageBody>
      <PageHeader
        title="Clients"
        description="People and companies you sell or rent to."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            Add client
          </Button>
        }
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, company, phone, email…" className="h-9 pl-9" />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Users} title={clients.length ? "No clients match" : "No clients yet"} description="Clients are added here or straight from a new order or rental." />
      ) : (
        <Card className="py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Client</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Open</TableHead>
                  <TableHead className="text-right">Lifetime value</TableHead>
                  <TableHead className="w-24 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const s = summary.get(c.id)
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback className="bg-primary/10 text-xs text-primary">{initials(c.name)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{c.name}</div>
                            {c.company && <div className="text-xs text-muted-foreground">{c.company}</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.phone && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="size-3 text-muted-foreground" />
                            {c.phone}
                          </div>
                        )}
                        {c.email && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Mail className="size-3" />
                            {c.email}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {s?.rentals ? <Pill tone="violet">{s.rentals} rental{s.rentals > 1 ? "s" : ""}</Pill> : null}
                          {s?.overdue ? <Pill tone="red">{s.overdue} overdue</Pill> : null}
                          {s?.orders ? <Pill tone="blue">{s.orders} order{s.orders > 1 ? "s" : ""}</Pill> : null}
                          {!s?.rentals && !s?.orders && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(s?.value ?? 0)}</TableCell>
                      <TableCell className="pr-4">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(c)} aria-label="Edit">
                            <Pencil />
                          </Button>
                          <ConfirmAction
                            trigger={
                              <Button variant="ghost" size="icon-sm" aria-label="Delete">
                                <Trash2 />
                              </Button>
                            }
                            title={`Delete ${c.name}?`}
                            description="Past orders and rentals stay in the records. Clients with open rentals or orders can't be deleted."
                            confirmLabel="Delete"
                            destructive
                            onConfirm={() => attempt(() => deleteClient(c.id), "Client deleted")}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {editing && <ClientDialog client={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </PageBody>
  )
}
