"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Ban, CalendarPlus, CheckCircle2, KeyRound, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmAction, Field, PageBody, PageHeader, Pill, SimpleSelect } from "@/components/common"
import { BusinessStatusPill, PaymentsTable } from "@/components/platform"
import { initials } from "@/components/user-menu"
import { deleteBusiness, grantAccess, resetOwnerPassword, setBusinessSuspended } from "@/lib/auth/platform-actions"
import type { ActionResult } from "@/lib/auth/user-actions"
import { roleLabel } from "@/lib/auth/roles"
import { formatDate, timeAgo } from "@/lib/format"
import { MODULES, PERMISSIONS, PRICE_LABEL, SUBSCRIPTION, accessEndsAt, daysLeft, formatTaka } from "@/lib/business"
import type { BusinessSummary, ManagedUser, ModuleId, Payment, PermissionId } from "@/lib/types"

function showResult(result: ActionResult, success: string) {
  if (result.ok) toast.success(success)
  else toast.error(result.error)
  return result.ok
}

export function BusinessDetailView({ business, users, payments }: { business: BusinessSummary; users: ManagedUser[]; payments: Payment[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [resetting, setResetting] = useState<ManagedUser | null>(null)
  const [granting, setGranting] = useState(false)
  const run = (fn: () => Promise<ActionResult>, success: string) => startTransition(async () => void showResult(await fn(), success))

  return (
    <PageBody>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" render={<Link href="/platform/businesses" />} nativeButton={false}>
        <ArrowLeft />
        Businesses
      </Button>
      <PageHeader
        title={business.name}
        description={`${business.industry || "No industry set"} · joined ${formatDate(business.createdAt)}`}
        actions={
          business.suspended ? (
            <Button disabled={pending} onClick={() => run(() => setBusinessSuspended(business.id, false), "Access restored")}>
              <CheckCircle2 />
              Restore access
            </Button>
          ) : (
            <ConfirmAction
              trigger={
                <Button variant="outline" disabled={pending}>
                  <Ban />
                  Suspend
                </Button>
              }
              title={`Suspend ${business.name}?`}
              description="Everyone in this business is logged out and can't log in, even if they pay, until you restore access. Nothing is deleted."
              confirmLabel="Suspend"
              destructive
              onConfirm={async () => showResult(await setBusinessSuspended(business.id, true), "Business suspended")}
            />
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <BusinessStatusPill status={business.status} />
        <Pill tone="gray">{business.settings.currency}</Pill>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Monthly, everything included</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold tabular-nums">{PRICE_LABEL}</p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border p-2">
                <dt className="text-xs text-muted-foreground">{business.paidUntil ? "Paid until" : "Trial ends"}</dt>
                <dd className="font-medium">{formatDate(accessEndsAt(business))}</dd>
              </div>
              <div className="rounded-lg border p-2">
                <dt className="text-xs text-muted-foreground">Days left</dt>
                <dd className="font-medium tabular-nums">{daysLeft(accessEndsAt(business))}</dd>
              </div>
            </dl>
            <Button variant="outline" className="w-full" onClick={() => setGranting(true)}>
              <CalendarPlus />
              Give access
            </Button>
            <p className="text-xs text-muted-foreground">
              {business.status === "unpaid"
                ? "Locked for not paying. The owner can log in only to pay; access comes back as soon as they do."
                : business.suspended
                  ? "Suspended by you. Paying won't unlock it until you restore access."
                  : "Locks itself automatically if the owner hasn't paid by this date."}
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Set up by the owner</CardTitle>
            <CardDescription>Only {business.owner?.name ?? "the owner"} can change these, from their Business Settings.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Features</p>
              <ul className="space-y-1.5 text-sm">
                {(Object.keys(MODULES) as ModuleId[]).map((id) => (
                  <OnOff key={id} on={business.settings.modules[id]} label={MODULES[id].label} />
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Team permissions</p>
              <ul className="space-y-1.5 text-sm">
                {(Object.keys(PERMISSIONS) as PermissionId[]).map((id) => (
                  <OnOff
                    key={id}
                    on={business.settings.permissions[id]}
                    label={`${PERMISSIONS[id].role === "manager" ? "Managers" : "Staff"}: ${PERMISSIONS[id].label.toLowerCase()}`}
                  />
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>People</CardTitle>
          <CardDescription>
            {users.length} {users.length === 1 ? "account" : "accounts"}. The owner creates and manages everyone else.
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="w-10 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarFallback className="bg-primary/10 text-xs text-primary">{initials(u.name)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Pill tone={u.role === "owner" ? "violet" : u.role === "manager" ? "blue" : "gray"}>{roleLabel(u)}</Pill>
                  </TableCell>
                  <TableCell>{u.active ? <Pill tone="green">Active</Pill> : <Pill tone="red">Disabled</Pill>}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never"}</TableCell>
                  <TableCell className="pr-4">
                    {u.role === "owner" && (
                      <Button variant="ghost" size="sm" onClick={() => setResetting(u)}>
                        <KeyRound />
                        Reset password
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>Payments</CardTitle>
          <CardDescription>Every payment by this business: online, sent by hand, or given by you.</CardDescription>
        </CardHeader>
        <PaymentsTable payments={payments} review />
      </Card>

      <Card className="border-destructive/30">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">Delete this business</p>
            <p className="text-sm text-muted-foreground">Removes the business and every account in it. This can&apos;t be undone.</p>
          </div>
          <ConfirmAction
            trigger={
              <Button variant="destructive">
                <Trash2 />
                Delete business
              </Button>
            }
            title={`Delete ${business.name}?`}
            description={`This removes the business and all ${users.length} of its accounts permanently.`}
            confirmLabel="Delete forever"
            destructive
            onConfirm={async () => {
              const ok = showResult(await deleteBusiness(business.id), "Business deleted")
              if (ok) router.push("/platform/businesses")
              return ok
            }}
          />
        </CardContent>
      </Card>

      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}
      {granting && <GrantDialog business={business} onClose={() => setGranting(false)} />}
    </PageBody>
  )
}

function OnOff({ on, label }: { on: boolean; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className={on ? undefined : "text-muted-foreground"}>{label}</span>
      {on ? <Pill tone="green">On</Pill> : <Pill tone="gray">Off</Pill>}
    </li>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const [password, setPassword] = useState("")
  const [pending, startTransition] = useTransition()
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            startTransition(async () => {
              if (showResult(await resetOwnerPassword(user.id, password), "Password changed")) onClose()
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Reset owner password</DialogTitle>
            <DialogDescription>Set a new password for {user.name}, then share it with them directly.</DialogDescription>
          </DialogHeader>
          <Field label="New password" htmlFor="op" hint="At least 8 characters.">
            <Input id="op" type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || password.length < 8}>
              Save password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const GRANT_METHODS = [
  { value: "bank", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
  { value: "rocket", label: "Rocket" },
  { value: "free", label: "Free (no payment)" },
]

/** Months given by hand: they paid you outside Friday, or you're giving them free time. */
function GrantDialog({ business, onClose }: { business: BusinessSummary; onClose: () => void }) {
  const [months, setMonths] = useState("1")
  const [method, setMethod] = useState("bank")
  const [amount, setAmount] = useState(String(SUBSCRIPTION.price))
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()
  const free = method === "free"
  const n = Number(months)
  const changeMonths = (v: string) => {
    setMonths(v)
    setAmount(String(SUBSCRIPTION.price * (Number(v) || 0)))
  }
  const valid = n >= 1 && n <= 24 && Number.isInteger(n) && (free || Number(amount) >= 0)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            startTransition(async () => {
              const result = await grantAccess(business.id, { months: n, amount: free ? 0 : Number(amount), method, reference, note })
              if (showResult(result, `${business.name} has ${n} more ${n === 1 ? "month" : "months"}`)) onClose()
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Give {business.name} access</DialogTitle>
            <DialogDescription>
              For money paid to you outside Friday, or free months. They start when current access ends ({formatDate(accessEndsAt(business))}), or today if
              it already has. The owner gets an invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Months" htmlFor="grant-months">
              <Input id="grant-months" type="number" min={1} max={24} value={months} onChange={(e) => changeMonths(e.target.value)} />
            </Field>
            <Field label="Paid by" htmlFor="grant-method">
              <SimpleSelect id="grant-method" value={method} onChange={setMethod} options={GRANT_METHODS} />
            </Field>
          </div>
          {!free && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount received" htmlFor="grant-amount" hint={`${formatTaka(SUBSCRIPTION.price)} a month`}>
                <Input id="grant-amount" type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Reference (optional)" htmlFor="grant-ref" hint="TrxID or bank reference">
                <Input id="grant-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} className="font-mono" />
              </Field>
            </div>
          )}
          <Field label="Note (optional)" htmlFor="grant-note">
            <Input id="grant-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={free ? "e.g. Sorry for the outage" : "e.g. Called on WhatsApp"} maxLength={300} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              Give {n >= 1 ? n : ""} {n === 1 ? "month" : "months"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
