"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { Mail, Pencil, Phone, Plus, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  attempt,
  ConfirmAction,
  EmptyState,
  ListSkeleton,
  PageBody,
  PageHeader,
  Pager,
  Pill,
  QueryError,
  SearchInput,
} from "@/components/common"
import { ClientDialog } from "@/components/client-dialog"
import { initials } from "@/components/user-menu"
import { actions } from "@/lib/data/actions"
import { useClients, useDebounced, usePaging } from "@/lib/data/queries"
import { formatMoney } from "@/lib/format"
import type { Client } from "@/lib/types"

export function ClientsView() {
  const params = useSearchParams()
  const [query, setQuery] = useState(params.get("q") ?? "")
  const [editing, setEditing] = useState<Client | "new" | null>(null)
  const search = useDebounced(query.trim())
  const paging = usePaging(search)
  const { data, error, isPending, isPlaceholderData, refetch } = useClients({ page: paging.page, search, stats: true }, { pageSize: paging.pageSize })
  const rows = data?.results ?? []

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

      <SearchInput value={query} onChange={setQuery} placeholder="Search name, company, phone, email…" className="max-w-md" />

      {error && !data ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title={search ? "No clients match" : "No clients yet"} description="Clients are added here or straight from a new order or rental." />
      ) : (
        <Card className={isPlaceholderData ? "py-0 opacity-60 transition-opacity" : "py-0"}>
          <div className="overflow-x-auto">
            <Table scroll>
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
                  const s = c.stats
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
                          {s?.activeRentals ? <Pill tone="violet">{s.activeRentals} rental{s.activeRentals > 1 ? "s" : ""}</Pill> : null}
                          {s?.overdueRentals ? <Pill tone="red">{s.overdueRentals} overdue</Pill> : null}
                          {s?.openOrders ? <Pill tone="blue">{s.openOrders} order{s.openOrders > 1 ? "s" : ""}</Pill> : null}
                          {!s?.activeRentals && !s?.openOrders && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(s?.lifetimeValue ?? 0)}</TableCell>
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
                            onConfirm={() => attempt(() => actions.deleteClient(c.id), "Client deleted")}
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
      {data && <Pager page={data.page} pageSize={paging.pageSize} count={data.count} onPage={paging.setPage} onPageSize={paging.setPageSize} busy={isPlaceholderData} />}

      {editing && <ClientDialog client={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </PageBody>
  )
}
