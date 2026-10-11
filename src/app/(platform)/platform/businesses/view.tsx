"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2, Loader2, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, Field, PageBody, PageHeader, SimpleSelect } from "@/components/common"
import { BusinessStatusPill, STATUS } from "@/components/platform"
import { createBusiness } from "@/lib/auth/platform-actions"
import { formatDate, timeAgo } from "@/lib/format"
import { PRICE_LABEL } from "@/lib/business"
import type { BusinessStatus, BusinessSummary } from "@/lib/types"

export function BusinessesView({ businesses, openNew }: { businesses: BusinessSummary[]; openNew: boolean }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | BusinessStatus>("all")
  const [creating, setCreating] = useState(openNew)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return businesses.filter(
      (b) =>
        (status === "all" || b.status === status) &&
        (!q || [b.name, b.industry, b.owner?.name, b.owner?.email].some((v) => v?.toLowerCase().includes(q))),
    )
  }, [businesses, query, status])

  return (
    <PageBody>
      <PageHeader
        title="Businesses"
        description="Every shop or company using the platform. Their owners run everything inside."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            Add business
          </Button>
        }
      />

      <div className="flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search business, owner or email…" className="h-9 pl-9" />
        </div>
        <SimpleSelect
          value={status}
          onChange={(v) => setStatus(v as "all" | BusinessStatus)}
          options={[{ value: "all", label: "All statuses" }, ...(Object.keys(STATUS) as BusinessStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))]}
          className="h-9! md:w-44"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Building2} title="No businesses found" description="Try a different search, or add a new business." />
      ) : (
        <Card className="py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Business</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead>Last active</TableHead>
                  <TableHead className="pr-4">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id} className="cursor-pointer" onClick={() => router.push(`/platform/businesses/${b.id}`)}>
                    <TableCell className="pl-4">
                      <Link href={`/platform/businesses/${b.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {b.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{b.industry || "—"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{b.owner?.name ?? "No owner"}</div>
                      <div className="text-xs text-muted-foreground">{b.owner?.email}</div>
                    </TableCell>
                    <TableCell>
                      <BusinessStatusPill status={b.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.userCount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.lastActiveAt ? timeAgo(b.lastActiveAt) : "Never"}</TableCell>
                    <TableCell className="pr-4 text-sm text-muted-foreground">{formatDate(b.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {creating && (
        <CreateBusinessDialog
          onClose={() => {
            setCreating(false)
            if (openNew) router.replace("/platform/businesses")
          }}
        />
      )}
    </PageBody>
  )
}

function CreateBusinessDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({ name: "", industry: "", trial: true, ownerName: "", ownerEmail: "", ownerPassword: "" })
  const [error, setError] = useState("")
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  const generate = () => {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    const bytes = crypto.getRandomValues(new Uint32Array(12))
    set("ownerPassword", Array.from(bytes, (b) => chars[b % chars.length]).join(""))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    startTransition(async () => {
      const result = await createBusiness(form)
      if (result.ok) {
        toast.success(`${form.name} created. Share the login with ${form.ownerName}.`)
        router.push(`/platform/businesses/${result.id}`)
      } else setError(result.error)
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a business</DialogTitle>
            <DialogDescription>Creates the business and its owner&apos;s login. The owner sets up shops, staff and features.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" htmlFor="nb-name">
              <Input id="nb-name" value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
            </Field>
            <Field label="Industry" htmlFor="nb-industry">
              <Input id="nb-industry" value={form.industry} onChange={(e) => set("industry", e.target.value)} placeholder="e.g. Clothing" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.trial} onCheckedChange={(on) => set("trial", on)} />
            Start as a free trial (otherwise billed {PRICE_LABEL})
          </label>
          <div className="space-y-4 rounded-lg border p-3">
            <p className="text-sm font-medium">Owner account</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="nb-owner">
                <Input id="nb-owner" value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="nb-email">
                <Input id="nb-email" type="email" autoComplete="off" value={form.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} />
              </Field>
            </div>
            <Field label="Password" htmlFor="nb-pass" hint="At least 8 characters.">
              <div className="flex gap-2">
                <Input
                  id="nb-pass"
                  type="text"
                  autoComplete="new-password"
                  value={form.ownerPassword}
                  onChange={(e) => set("ownerPassword", e.target.value)}
                  className="font-mono"
                />
                <Button type="button" variant="outline" onClick={generate}>
                  Generate
                </Button>
              </div>
            </Field>
          </div>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Create business
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
