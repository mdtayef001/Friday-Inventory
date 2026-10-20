"use client"

import { useState } from "react"
import Link from "next/link"
import { AlarmClock, ArrowLeft, Factory, HandCoins, Mail, MapPin, PackagePlus, PackageX, Pencil, Phone, Trash2, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { attempt, ConfirmAction, EmptyState, ListSkeleton, MoneyTotal, PageBody, PageHeader, Pill, QueryError, StatCard } from "@/components/common"
import { PurchaseDialog } from "@/components/purchase-dialog"
import { useSessionUser } from "@/components/session-provider"
import { SupplierDialog } from "@/components/supplier-dialog"
import { PAYMENT_METHOD_LABEL, PaySupplierDialog } from "@/components/supplier-payment"
import { ApiError } from "@/lib/api/errors"
import { actions } from "@/lib/data/actions"
import { useSupplier, useSupplierStatement } from "@/lib/data/queries"
import { formatDate, formatMoney } from "@/lib/format"
import type { StatementEntry } from "@/lib/types"

export function SupplierDetailView({ id }: { id: string }) {
  const { role } = useSessionUser()
  const isOwner = role === "owner"
  const { data: supplier, error, isPending, refetch } = useSupplier(id)
  const statement = useSupplierStatement(id, isOwner)
  const [editing, setEditing] = useState(false)
  const [buying, setBuying] = useState(false)
  const [paying, setPaying] = useState(false)

  if (error instanceof ApiError && error.status === 404) {
    return (
      <PageBody>
        <EmptyState
          icon={Factory}
          title="Supplier not found"
          description="It may have been deleted."
          action={
            <Button render={<Link href="/suppliers" />} nativeButton={false}>
              Back to suppliers
            </Button>
          }
        />
      </PageBody>
    )
  }
  if (error && !supplier) return <PageBody><QueryError error={error} onRetry={() => refetch()} /></PageBody>
  if (isPending || !supplier) return <PageBody><ListSkeleton /></PageBody>

  const stats = supplier.stats
  const owed = statement.data?.owed ?? stats?.owed ?? 0
  const overdue = statement.data?.overdue ?? 0
  const brief = { id: supplier.id, name: supplier.name, company: supplier.company }

  return (
    <PageBody>
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/suppliers" />} nativeButton={false}>
        <ArrowLeft />
        Suppliers
      </Button>
      <PageHeader
        title={supplier.name}
        description={supplier.company || "Supplier"}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil />
              Edit
            </Button>
            <Button variant="outline" onClick={() => setBuying(true)}>
              <PackagePlus />
              New purchase
            </Button>
            {isOwner && (
              <Button onClick={() => setPaying(true)} disabled={owed <= 0}>
                <HandCoins />
                Pay
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isOwner && (
          <StatCard
            label="You owe"
            value={<MoneyTotal value={owed} />}
            hint={owed > 0 ? "On bills bought on credit" : "Nothing. All bills are paid."}
            icon={Wallet}
            tone={owed > 0 ? "amber" : "green"}
          />
        )}
        {isOwner && (
          <StatCard
            label="Overdue"
            value={<MoneyTotal value={overdue} />}
            hint={overdue > 0 ? "Past the date it was due" : "Nothing overdue"}
            icon={AlarmClock}
            tone={overdue > 0 ? "red" : "default"}
          />
        )}
        <StatCard
          label="They owe you"
          value={<MoneyTotal value={stats?.owedBack ?? 0} />}
          hint={
            stats?.owedBack ? (
              <Link href="/supplier-returns" className="underline underline-offset-2">
                From returns waiting to be settled
              </Link>
            ) : (
              "No returns waiting"
            )
          }
          icon={PackageX}
          tone={stats?.owedBack ? "amber" : "default"}
        />
        <StatCard
          label="Bought in total"
          value={<MoneyTotal value={stats?.spent ?? 0} />}
          hint={
            <Link href={`/purchases?supplier=${supplier.id}`} className="underline underline-offset-2">
              {stats?.purchaseCount ?? 0} purchase{stats?.purchaseCount === 1 ? "" : "s"}
            </Link>
          }
          icon={Factory}
        />
      </div>

      {(supplier.phone || supplier.email || supplier.address) && (
        <Card size="sm">
          <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {supplier.phone && (
              <span className="flex items-center gap-1.5">
                <Phone className="size-3.5 text-muted-foreground" />
                {supplier.phone}
              </span>
            )}
            {supplier.email && (
              <span className="flex items-center gap-1.5">
                <Mail className="size-3.5 text-muted-foreground" />
                {supplier.email}
              </span>
            )}
            {supplier.address && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5 text-muted-foreground" />
                {supplier.address}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {isOwner && (
        <Card className="pb-0">
          <CardHeader>
            <CardTitle>Statement</CardTitle>
            <CardDescription>Every bill and payment with {supplier.name}, newest first, and what you owed after each.</CardDescription>
          </CardHeader>
          {statement.error && !statement.data ? (
            <CardContent className="pb-6">
              <QueryError error={statement.error} onRetry={() => statement.refetch()} />
            </CardContent>
          ) : !statement.data ? (
            <CardContent className="pb-6">
              <ListSkeleton rows={4} />
            </CardContent>
          ) : statement.data.entries.length === 0 ? (
            <CardContent className="pb-6">
              <EmptyState icon={Wallet} title="Nothing yet" description="Purchases from this supplier and payments to them show up here." />
            </CardContent>
          ) : (
            <div className="overflow-x-auto border-t">
              <Table scroll>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead className="text-right">Bill</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">You owed after</TableHead>
                    <TableHead className="w-10 pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.data.entries.map((e) => (
                    <StatementRow key={`${e.kind}-${e.id}`} entry={e} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

      {editing && <SupplierDialog supplier={supplier} onClose={() => setEditing(false)} />}
      {buying && <PurchaseDialog supplier={brief} onClose={() => setBuying(false)} />}
      {paying && <PaySupplierDialog supplier={brief} owed={owed} onClose={() => setPaying(false)} />}
    </PageBody>
  )
}

function StatementRow({ entry: e }: { entry: StatementEntry }) {
  const overdue = e.kind === "purchase" && e.status !== "paid" && !!e.dueDate && new Date(`${e.dueDate}T23:59:59`) < new Date()
  return (
    <TableRow>
      <TableCell className="pl-4 text-sm whitespace-nowrap">{formatDate(e.at)}</TableCell>
      <TableCell className="text-sm">
        {e.kind === "purchase" ? (
          <>
            <span className="font-medium">
              Bill <span className="font-mono">{e.code}</span>
            </span>
            {e.reference && <span className="text-muted-foreground"> · {e.reference}</span>}
            {e.status !== "paid" && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                <Pill tone={overdue ? "red" : "amber"}>{overdue ? "Overdue" : e.status === "unpaid" ? "Unpaid" : "Partly paid"}</Pill>
                {e.dueDate && <span className="text-xs text-muted-foreground">due {formatDate(e.dueDate)}</span>}
              </div>
            )}
          </>
        ) : (
          <>
            <span className="font-medium">
              {e.method === "credit" ? "Return credit" : "Payment"} <span className="font-mono">{e.code}</span>
            </span>
            <span className="text-muted-foreground">
              {e.method && e.method !== "credit" ? ` · ${PAYMENT_METHOD_LABEL[e.method]}` : ""}
              {!e.method ? " · method not recorded" : ""}
              {e.note ? ` · ${e.note}` : ""}
            </span>
          </>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{e.kind === "purchase" ? formatMoney(e.amount) : ""}</TableCell>
      <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{e.kind === "payment" ? formatMoney(e.amount) : ""}</TableCell>
      <TableCell className="text-right font-medium tabular-nums">{formatMoney(e.balance)}</TableCell>
      <TableCell className="pr-4">
        {e.kind === "payment" && e.method !== "credit" && (
          <ConfirmAction
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label={`Delete payment ${e.code}`}>
                <Trash2 />
              </Button>
            }
            title={`Delete payment ${e.code}?`}
            description={`Only if it was recorded by mistake. The ${formatMoney(e.amount)} goes back onto the bills it paid.`}
            confirmLabel="Delete"
            destructive
            onConfirm={() => attempt(() => actions.deleteSupplierPayment(e.id), "Payment deleted")}
          />
        )}
      </TableCell>
    </TableRow>
  )
}
