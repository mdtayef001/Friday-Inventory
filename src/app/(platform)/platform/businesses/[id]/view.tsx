"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Ban, CheckCircle2, KeyRound, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmAction, Field, PageBody, PageHeader, Pill, SimpleSelect } from "@/components/common"
import { BusinessStatusPill, PlanPill } from "@/components/platform"
import { initials } from "@/components/user-menu"
import { deleteBusiness, resetOwnerPassword, setBusinessPlan, setBusinessStatus } from "@/lib/auth/platform-actions"
import type { ActionResult } from "@/lib/auth/user-actions"
import { ROLE_LABEL } from "@/lib/auth/roles"
import { formatDate, timeAgo } from "@/lib/format"
import { MODULES, PERMISSIONS, PLAN_IDS, PLANS, formatLimit } from "@/lib/plans"
import type { BusinessSummary, ManagedUser, ModuleId, PermissionId, PlanId } from "@/lib/types"

function showResult(result: ActionResult, success: string) {
  if (result.ok) toast.success(success)
  else toast.error(result.error)
  return result.ok
}

export function BusinessDetailView({ business, users }: { business: BusinessSummary; users: ManagedUser[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [resetting, setResetting] = useState<ManagedUser | null>(null)
  const plan = PLANS[business.plan]
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
          <>
            {business.status === "suspended" ? (
              <Button disabled={pending} onClick={() => run(() => setBusinessStatus(business.id, "active"), "Business restored")}>
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
                description="Everyone in this business is logged out and can't log in until you restore access. Nothing is deleted."
                confirmLabel="Suspend"
                destructive
                onConfirm={async () => showResult(await setBusinessStatus(business.id, "suspended"), "Business suspended")}
              />
            )}
            {business.status === "trial" && (
              <Button variant="outline" disabled={pending} onClick={() => run(() => setBusinessStatus(business.id, "active"), "Marked as paying")}>
                End trial
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <BusinessStatusPill status={business.status} />
        <PlanPill plan={business.plan} />
        <Pill tone="gray">{business.settings.currency}</Pill>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Plan</CardTitle>
            <CardDescription>
              {plan.price} USD / month · {plan.blurb}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Change plan">
              <SimpleSelect
                value={business.plan}
                onChange={(v) => run(() => setBusinessPlan(business.id, v as PlanId), `Plan changed to ${PLANS[v as PlanId].name}`)}
                options={PLAN_IDS.map((id) => ({ value: id, label: `${PLANS[id].name} · ${PLANS[id].price} USD/mo` }))}
              />
            </Field>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {(["locations", "users", "products"] as const).map((k) => (
                <div key={k} className="rounded-lg border p-2">
                  <dt className="text-xs text-muted-foreground capitalize">{k}</dt>
                  <dd className="font-semibold tabular-nums">
                    {k === "users" ? `${business.userCount} / ` : ""}
                    {formatLimit(plan.limits[k])}
                  </dd>
                </div>
              ))}
            </dl>
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
            {users.length} of {formatLimit(plan.limits.users)} users. The owner creates and manages everyone else.
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
                    <Pill tone={u.role === "owner" ? "violet" : u.role === "manager" ? "blue" : "gray"}>{ROLE_LABEL[u.role]}</Pill>
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
