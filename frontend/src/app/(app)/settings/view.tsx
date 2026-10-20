"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Building2, Loader2, Puzzle, ReceiptText, ShieldCheck, Sparkles, Wallet } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { YourDataCard } from "@/components/billing"
import { DeleteBusinessCard } from "@/components/leaving"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Field, PageBody, PageHeader, SimpleSelect, useRequired } from "@/components/common"
import { BusinessStatusPill } from "@/components/platform"
import { useBusiness, useSessionUser } from "@/components/session-provider"
import { updateBusinessSettings } from "@/lib/auth/business-actions"
import { priceLabel, CURRENCIES, CURRENCY_LABEL, MODULES, PERMISSIONS, accessEndsAt, daysLeft } from "@/lib/business"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { BusinessSettings, ModuleId, PermissionId } from "@/lib/types"

export function SettingsView() {
  const business = useBusiness()
  const user = useSessionUser()
  const [name, setName] = useState(business.name)
  const [industry, setIndustry] = useState(business.industry)
  const [settings, setSettings] = useState<BusinessSettings>(business.settings)
  const [pending, startTransition] = useTransition()

  const dirty =
    name !== business.name || industry !== business.industry || JSON.stringify(settings) !== JSON.stringify(business.settings)

  // Client tracking links only work with orders, so turning orders off turns the links off too.
  const setModule = (id: ModuleId, on: boolean) =>
    setSettings((s) => ({ ...s, modules: { ...s.modules, [id]: on, ...(id === "tracking" && !on && { trackingLinks: false }) } }))
  const alertOk = Number.isInteger(settings.lowStockAlert) && settings.lowStockAlert >= 0
  const setPermission = (id: PermissionId, on: boolean) => setSettings((s) => ({ ...s, permissions: { ...s.permissions, [id]: on } }))
  const setPayments = (patch: Partial<BusinessSettings["payments"]>) => setSettings((s) => ({ ...s, payments: { ...s.payments, ...patch } }))

  const required = useRequired()
  const nameOk = name.trim().length >= 2

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!required.check(nameOk && alertOk, e)) return
    startTransition(async () => {
      const result = await updateBusinessSettings({ name, industry, settings })
      if (result.ok) toast.success("Settings saved. Everyone sees the change on their next page load.")
      else toast.error(result.error)
    })
  }

  const permissionRows = (role: "manager" | "staff") =>
    (Object.keys(PERMISSIONS) as PermissionId[])
      .filter((id) => PERMISSIONS[id].role === role)
      .map((id) => (
        <ToggleRow
          key={id}
          id={`perm-${id}`}
          label={PERMISSIONS[id].label}
          description={PERMISSIONS[id].description}
          checked={settings.permissions[id]}
          onChange={(on) => setPermission(id, on)}
        />
      ))

  return (
    <PageBody className="max-w-4xl">
      <PageHeader title="Business settings" description="You're the owner, so you decide how this business works and what your team can do." />

      <form onSubmit={save} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              Business profile
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="Business name" htmlFor="b-name" required missing={required.shown && !nameOk}>
              <Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Industry" htmlFor="b-industry">
              <Input id="b-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Hardware store" />
            </Field>
            <Field label="Currency" required>
              <SimpleSelect
                value={settings.currency}
                onChange={(currency) => setSettings((s) => ({ ...s, currency }))}
                options={[...CURRENCIES, ...(CURRENCIES.includes(business.settings.currency) ? [] : [business.settings.currency])].map((c) => ({
                  value: c,
                  label: CURRENCY_LABEL[c] ?? c,
                }))}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Puzzle className="size-4 text-primary" />
              Features
            </CardTitle>
            <CardDescription>Turn off what you don&apos;t use. It disappears from the menu for everyone.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {(Object.keys(MODULES) as ModuleId[]).map((id) => (
              <ToggleRow
                key={id}
                id={`mod-${id}`}
                label={MODULES[id].label}
                description={MODULES[id].description}
                checked={settings.modules[id]}
                onChange={(on) => setModule(id, on)}
                disabled={id === "trackingLinks" && !settings.modules.tracking}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="size-4 text-primary" />
              Payment methods
            </CardTitle>
            <CardDescription>How customers can pay when your team sells. Cash only is fine; turn on what you use.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <label className="flex items-center justify-between gap-4 py-3">
              <span>
                <span className="block text-sm font-medium">Cash</span>
                <span className="block text-xs text-muted-foreground">Always available.</span>
              </span>
              <Switch checked disabled />
            </label>
            <ToggleRow
              id="pay-mobile"
              label="Mobile banking (bKash / Nagad)"
              description="Staff enter the transaction ID from the customer's payment; it goes on the receipt."
              checked={settings.payments.mobile}
              onChange={(on) => setPayments({ mobile: on })}
            />
            <ToggleRow
              id="pay-card"
              label="Card machine"
              description="Paid on your own card terminal; staff confirm it went through."
              checked={settings.payments.card}
              onChange={(on) => setPayments({ card: on })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ReceiptText className="size-4 text-primary" />
              Receipts and stock
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <Field
              label="Receipt note"
              htmlFor="b-receipt-note"
              hint={`At the bottom of every receipt, e.g. your return policy or bKash number. ${settings.receiptNote.length}/200`}
            >
              <Textarea
                id="b-receipt-note"
                value={settings.receiptNote}
                onChange={(e) => setSettings((s) => ({ ...s, receiptNote: e.target.value }))}
                maxLength={200}
                rows={2}
                placeholder="e.g. Returns within 7 days with this receipt."
              />
            </Field>
            <Field
              label="Low-stock alert for new products"
              htmlFor="b-low-stock"
              required
              missing={required.shown && !alertOk}
              hint="Warn when a shop has this many or fewer. Each product can still have its own."
            >
              <Input
                id="b-low-stock"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={Number.isNaN(settings.lowStockAlert) ? "" : settings.lowStockAlert}
                onChange={(e) => setSettings((s) => ({ ...s, lowStockAlert: e.target.value.trim() === "" ? NaN : Number(e.target.value) }))}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              What your team can do
            </CardTitle>
            <CardDescription>
              Managers always handle stock, orders, rentals and clients at their own shops. Each staff member&apos;s own rights (sell, add stock,
              rent out) are set on{" "}
              <Link href="/users" className="font-medium text-primary underline-offset-2 hover:underline">
                Users &amp; Staff
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Managers can</p>
              <div className="divide-y">{permissionRows("manager")}</div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Staff can</p>
              <div className="divide-y">{permissionRows("staff")}</div>
            </div>
          </CardContent>
        </Card>

        <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
          <span className="mr-auto text-sm text-muted-foreground">{dirty ? "You have unsaved changes." : "All changes saved."}</span>
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || pending}
            onClick={() => {
              setName(business.name)
              setIndustry(business.industry)
              setSettings(business.settings)
            }}
          >
            Discard
          </Button>
          <Button type="submit" disabled={!dirty || pending}>
            {pending && <Loader2 className="animate-spin" />}
            Save changes
          </Button>
        </div>
      </form>

      <SubscriptionCard />
      <YourDataCard />
      <DeleteBusinessCard business={business} isMainOwner={user.isMainOwner} />
    </PageBody>
  )
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
}) {
  return (
    <label data-setting={id} className={cn("flex items-center justify-between gap-4 py-3", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  )
}

function SubscriptionCard() {
  const business = useBusiness()
  const endsAt = accessEndsAt(business)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          Subscription
        </CardTitle>
        <CardDescription>One simple plan with everything included and no limits.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-2xl font-semibold tabular-nums">{priceLabel(business.monthlyPrice)}</p>
          <p className="text-sm text-muted-foreground">
            {business.cancelledAt
              ? `Cancelled. Works until ${formatDate(endsAt)} · ${daysLeft(endsAt)} days left`
              : `${business.status === "trial" ? "Free trial ends" : "Paid until"} ${formatDate(endsAt)} · ${daysLeft(endsAt)} days left`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <BusinessStatusPill status={business.status} />
          <Button variant="outline" render={<Link href="/billing" />} nativeButton={false}>
            Billing & invoices
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
