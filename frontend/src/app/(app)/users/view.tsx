"use client"

import { useState, useTransition } from "react"
import { KeyRound, Loader2, MoreHorizontal, Pencil, Power, ShieldCheck, Trash2, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmAction, Field, PageBody, PageHeader, Pill, SimpleSelect, type PillTone } from "@/components/common"
import { useBusiness, useScope, useSessionUser } from "@/components/session-provider"
import { initials } from "@/components/user-menu"
import { creatableRoles, ROLE_LABEL } from "@/lib/auth/roles"
import { createUser, deleteUser, resetUserPassword, setUserActive, setUserRights, updateUser, type ActionResult } from "@/lib/auth/user-actions"
import { formatDate } from "@/lib/format"
import { useLocations } from "@/lib/data/queries"
import type { ManagedUser, Role, TenantRole } from "@/lib/types"

const ROLE_TONE: Record<Role, PillTone> = { superadmin: "violet", owner: "violet", manager: "blue", staff: "gray" }
const ROLE_HELP: Record<TenantRole, string> = {
  owner: "Full access to the business: every location, account and setting.",
  manager: "Runs their assigned shops. What else they can do is set in Business Settings.",
  staff: "Uses Quick Entry to add products and stock at their shops.",
}

function showResult(result: ActionResult, success: string) {
  if (result.ok) toast.success(success)
  else toast.error(result.error)
  return result.ok
}

export function UsersView({ users }: { users: ManagedUser[] }) {
  const me = useSessionUser()
  const business = useBusiness()
  const locations = useLocations()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [resetting, setResetting] = useState<ManagedUser | null>(null)
  const [deleting, setDeleting] = useState<ManagedUser | null>(null)
  const [, startTransition] = useTransition()
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Unknown"

  return (
    <PageBody>
      <PageHeader
        title={me.role === "owner" ? "Users & staff" : "My staff"}
        description={
          me.role === "owner"
            ? `Accounts for ${business.name}. There is no public sign-up.`
            : "Create logins for staff at your shops. Staff can only add products and stock."
        }
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus />
            {me.role === "owner" ? "Create account" : "Add staff member"}
          </Button>
        }
      />

      <Card className="py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Locations</TableHead>
                <TableHead>Can do</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const isMe = u.id === me.id
                return (
                  <TableRow key={u.id} className={u.active ? undefined : "opacity-60"}>
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback className="bg-primary/10 text-xs text-primary">{initials(u.name)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">
                            {u.name} {isMe && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Pill tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Pill>
                    </TableCell>
                    <TableCell className="max-w-64 text-sm text-muted-foreground">
                      {u.role === "owner" ? "All locations" : u.locationIds.map(locationName).join(", ")}
                    </TableCell>
                    <TableCell>
                      {u.role !== "staff" ? (
                        <span className="text-sm text-muted-foreground">Everything</span>
                      ) : (
                        <div className="grid gap-1.5">
                          {(
                            [
                              ["canSell", "Sell"],
                              ["canAddStock", "Add stock"],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-2 text-sm whitespace-nowrap">
                              <Switch
                                size="sm"
                                checked={u[key]}
                                disabled={isMe}
                                aria-label={`${label}: ${u.name}`}
                                onCheckedChange={(on) =>
                                  startTransition(async () => {
                                    showResult(await setUserRights(u.id, { [key]: on }), `${u.name} ${on ? "can" : "can no longer"} ${label.toLowerCase()}`)
                                  })
                                }
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{u.active ? <Pill tone="green">Active</Pill> : <Pill tone="red">Disabled</Pill>}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                    <TableCell className="pr-4">
                      {!isMe && (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}>
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => setEditing(u)}>
                              <Pencil />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setResetting(u)}>
                              <KeyRound />
                              Reset password
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                startTransition(async () => {
                                  showResult(await setUserActive(u.id, !u.active), u.active ? "Account disabled" : "Account enabled")
                                })
                              }
                            >
                              <Power />
                              {u.active ? "Disable login" : "Enable login"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(u)}>
                              <Trash2 />
                              Delete account
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="flex items-start gap-2 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Disabling an account logs that person out right away. Passwords are stored hashed and are never shown again after you set them, so share
          them with the person directly.
        </p>
      </div>

      {creating && <UserDialog onClose={() => setCreating(false)} />}
      {editing && <UserDialog key={editing.id} user={editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}
      {deleting && (
        <ConfirmAction
          defaultOpen
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting.name}'s account?`}
          description="They can't log in again. Their sales, orders and other records stay, but without their name, which shows as blank. To keep their name on past work, disable their login instead."
          confirmLabel="Delete account"
          destructive
          onConfirm={async () => showResult(await deleteUser(deleting.id), "Account deleted")}
        />
      )}
    </PageBody>
  )
}

/** Create an account, or edit one (name, email, role, locations, staff rights). The password is changed separately. */
function UserDialog({ user, onClose }: { user?: ManagedUser; onClose: () => void }) {
  const me = useSessionUser()
  const scope = useScope()
  const roles = creatableRoles(me.role)
  const [pending, startTransition] = useTransition()
  const [role, setRole] = useState<TenantRole>(user ? (user.role as TenantRole) : roles.includes("staff") ? "staff" : roles[0])
  const [name, setName] = useState(user?.name ?? "")
  const [email, setEmail] = useState(user?.email ?? "")
  const [password, setPassword] = useState("")
  // Only the locations this person may hand out are shown; others they work at are kept as they are.
  const [locationIds, setLocationIds] = useState<string[]>(
    user ? user.locationIds.filter((id) => scope.has(id)) : scope.locations.length === 1 ? [scope.locations[0].id] : [],
  )
  const kept = user ? user.locationIds.filter((id) => !scope.has(id)) : []
  const [canSell, setCanSell] = useState(user?.canSell ?? true)
  const [canAddStock, setCanAddStock] = useState(user?.canAddStock ?? true)
  const [error, setError] = useState("")

  const toggle = (id: string, on: boolean) => setLocationIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)))
  const generate = () => {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    const bytes = crypto.getRandomValues(new Uint32Array(12))
    setPassword(Array.from(bytes, (b) => chars[b % chars.length]).join(""))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    startTransition(async () => {
      const where = role === "owner" ? [] : [...kept, ...locationIds]
      const result = user
        ? await updateUser(user.id, { name, email, role, locationIds: where, ...(role === "staff" && { canSell, canAddStock }) })
        : await createUser({ name, email, password, role, locationIds: where })
      if (result.ok) {
        toast.success(user ? `${name} updated` : `Account created for ${name}`)
        onClose()
      } else setError(result.error)
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{user ? `Edit ${user.name}` : me.role === "owner" ? "Create account" : "Add staff member"}</DialogTitle>
            <DialogDescription>
              {user
                ? "Changes apply the next time they open a page. Their password stays the same; use Reset password to change it."
                : "They log in on the normal login page with this email and password."}
            </DialogDescription>
          </DialogHeader>
          {roles.length > 1 && (
            <Field label="Role" hint={ROLE_HELP[role]}>
              <SimpleSelect value={role} onChange={(v) => setRole(v as TenantRole)} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="u-name">
              <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label="Email" htmlFor="u-email">
              <Input id="u-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          {!user && (
            <Field label="Password" htmlFor="u-pass" hint="At least 8 characters.">
              <div className="flex gap-2">
                <Input id="u-pass" type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
                <Button type="button" variant="outline" onClick={generate}>
                  Generate
                </Button>
              </div>
            </Field>
          )}
          {role !== "owner" && (
            <Field label="Works at">
              <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                {scope.locations.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={locationIds.includes(l.id)} onCheckedChange={(on) => toggle(l.id, on)} />
                    {l.name}
                  </label>
                ))}
              </div>
              {kept.length > 0 && (
                <p className="text-xs text-muted-foreground">Also works at {kept.length} location(s) you don&apos;t run. Those stay as they are.</p>
              )}
            </Field>
          )}
          {user && role === "staff" && (
            <Field label="Can do">
              <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm">
                  <Switch size="sm" checked={canSell} onCheckedChange={setCanSell} />
                  Sell
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch size="sm" checked={canAddStock} onCheckedChange={setCanAddStock} />
                  Add stock
                </label>
              </div>
            </Field>
          )}
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {user ? "Save changes" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
              if (showResult(await resetUserPassword(user.id, password), "Password changed")) onClose()
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>Set a new password for {user.name}.</DialogDescription>
          </DialogHeader>
          <Field label="New password" htmlFor="rp" hint="At least 8 characters.">
            <Input id="rp" type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" autoFocus />
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
