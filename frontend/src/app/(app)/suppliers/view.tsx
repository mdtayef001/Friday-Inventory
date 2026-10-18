"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Factory, Mail, Pencil, Phone, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { attempt, ConfirmAction, EmptyState, ListSkeleton, PageBody, PageHeader, Pager, QueryError, SearchInput } from "@/components/common"
import { SupplierDialog } from "@/components/supplier-dialog"
import { initials } from "@/components/user-menu"
import { actions } from "@/lib/data/actions"
import { useDebounced, usePaging, useSuppliers } from "@/lib/data/queries"
import { formatDate, formatMoney } from "@/lib/format"
import type { Supplier } from "@/lib/types"

export function SuppliersView() {
  const params = useSearchParams()
  const [query, setQuery] = useState(params.get("q") ?? "")
  const [editing, setEditing] = useState<Supplier | "new" | null>(null)
  const search = useDebounced(query.trim())
  const paging = usePaging(search)
  const { data, error, isPending, isPlaceholderData, refetch } = useSuppliers({ page: paging.page, search, stats: true }, { pageSize: paging.pageSize })
  const rows = data?.results ?? []

  return (
    <PageBody>
      <PageHeader
        title="Suppliers"
        description="Who you buy stock from, and how much you've bought from each."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            Add supplier
          </Button>
        }
      />

      <SearchInput value={query} onChange={setQuery} placeholder="Search name, company, phone, email…" className="max-w-md" />

      {error && !data ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={Factory} title={search ? "No suppliers match" : "No suppliers yet"} description="Suppliers are added here or straight from a new purchase." />
      ) : (
        <Card className={isPlaceholderData ? "py-0 opacity-60 transition-opacity" : "py-0"}>
          <div className="overflow-x-auto">
            <Table scroll>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Supplier</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Purchases</TableHead>
                  <TableHead className="text-right">Bought in total</TableHead>
                  <TableHead className="w-24 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => {
                  const stats = s.stats
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback className="bg-primary/10 text-xs text-primary">{initials(s.name)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{s.name}</div>
                            {s.company && <div className="text-xs text-muted-foreground">{s.company}</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.phone && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="size-3 text-muted-foreground" />
                            {s.phone}
                          </div>
                        )}
                        {s.email && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Mail className="size-3" />
                            {s.email}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {stats?.purchaseCount ? (
                          <Link href={`/purchases?supplier=${s.id}`} className="underline-offset-2 hover:underline">
                            {stats.purchaseCount} purchase{stats.purchaseCount > 1 ? "s" : ""}
                            {stats.lastPurchaseAt && <span className="block text-xs text-muted-foreground">Last {formatDate(stats.lastPurchaseAt)}</span>}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">None yet</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(stats?.spent ?? 0)}
                        {stats?.owedBack ? (
                          <Link href="/supplier-returns" className="block text-xs text-amber-700 underline-offset-2 hover:underline dark:text-amber-400">
                            Owes you {formatMoney(stats.owedBack)}
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(s)} aria-label="Edit">
                            <Pencil />
                          </Button>
                          <ConfirmAction
                            trigger={
                              <Button variant="ghost" size="icon-sm" aria-label="Delete">
                                <Trash2 />
                              </Button>
                            }
                            title={`Delete ${s.name}?`}
                            description="Suppliers you've bought from can't be deleted, so your purchases keep saying who sold them."
                            confirmLabel="Delete"
                            destructive
                            onConfirm={() => attempt(() => actions.deleteSupplier(s.id), "Supplier deleted")}
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

      {editing && <SupplierDialog supplier={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </PageBody>
  )
}
