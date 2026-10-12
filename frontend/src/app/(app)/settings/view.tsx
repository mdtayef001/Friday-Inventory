"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Building2, CreditCard, KeyRound, Loader2, Puzzle, ShieldCheck, Sparkles, Trash2, Wallet } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ConfirmAction, Field, PageBody, PageHeader, Pill, SimpleSelect } from "@/components/common"
import { BusinessStatusPill } from "@/components/platform"
import { useBusiness } from "@/components/session-provider"
import { removeMerchantAccount, saveMerchantAccount, updateBusinessSettings, type MerchantAccount } from "@/lib/auth/business-actions"
import { CURRENCIES, MODULES, PERMISSIONS, PRICE_LABEL, accessEndsAt, daysLeft } from "@/lib/business"
import { formatDate } from "@/lib/format"
import type { BusinessSettings, ModuleId, PermissionId } from "@/lib/types"

export function SettingsView({ merchant }: { merchant: MerchantAccount }) {
  const business = useBusiness()
  const [name, setName] = useState(business.name)
  const [industry, setIndustry] = useState(business.industry)
  const [settings, setSettings] = useState<BusinessSettings>(business.settings)
  const [pending, startTransition] = useTransition()

  const dirty =
    name !== business.name || industry !== business.industry || JSON.stringify(settings) !== JSON.stringify(business.settings)

  const setModule = (id: ModuleId, on: boolean) => setSettings((s) => ({ ...s, modules: { ...s.modules, [id]: on } }))
  const setPermission = (id: PermissionId, on: boolean) => setSettings((s) => ({ ...s, permissions: { ...s.permissions, [id]: on } }))
  const setPayments = (patch: Partial<BusinessSettings["payments"]>) => setSettings((s) => ({ ...s, payments: { ...s.payments, ...patch } }))

  function save(e: React.FormEvent) {
    e.preventDefault()
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
            <Field label="Business name" htmlFor="b-name">
              <Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Industry" htmlFor="b-industry">
              <Input id="b-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Hardware store" />
            </Field>
            <Field label="Currency">
              <SimpleSelect
                value={settings.currency}
                onChange={(currency) => setSettings((s) => ({ ...s, currency }))}
                options={CURRENCIES.map((c) => ({ value: c, label: c }))}
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
            <div className="py-3">
              <ToggleRow
                id="pay-mobile"
                label="Mobile banking (bKash / Nagad)"
                description="Customers send money to your number; staff confirm they received it."
                checked={settings.payments.mobile}
                onChange={(on) => setPayments({ mobile: on })}
              />
              {settings.payments.mobile && (
                <Field label="Number shown to customers" htmlFor="pay-mobile-number" hint='For example "bKash 01711000000 (personal)".'>
                  <Input
                    id="pay-mobile-number"
                    value={settings.payments.mobileNumber}
                    onChange={(e) => setPayments({ mobileNumber: e.target.value })}
                    maxLength={60}
                    placeholder="bKash 01711000000"
                  />
                </Field>
              )}
            </div>
            <ToggleRow
              id="pay-card"
              label="Card machine"
              description="Paid on your own card terminal; staff confirm it went through."
              checked={settings.payments.card}
              onChange={(on) => setPayments({ card: on })}
            />
            <ToggleRow
              id="pay-online"
              label="Online (SSLCommerz)"
              description={
                merchant.configured
                  ? "Customers scan a QR code and pay on their phone. Confirmed automatically by SSLCommerz."
                  : "Add your own SSLCommerz account below first."
              }
              checked={settings.payments.online}
              disabled={!merchant.configured}
              onChange={(on) => setPayments({ online: on })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              What your team can do
            </CardTitle>
            <CardDescription>
              Managers always handle stock, orders, rentals and clients at their own shops. Staff always use Quick Entry.
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

      <MerchantCard merchant={merchant} />
      <SubscriptionCard />
    </PageBody>
  )
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label data-setting={id} className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  )
}

/** The business's own SSLCommerz account. Separate from the subscription, which is paid to the platform. */
function MerchantCard({ merchant }: { merchant: MerchantAccount }) {
  const [storeId, setStoreId] = useState(merchant.storeId ?? "")
  const [password, setPassword] = useState("")
  const [sandbox, setSandbox] = useState(merchant.sandbox ?? true)
  const [pending, startTransition] = useTransition()

  function save(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await saveMerchantAccount({ storeId, storePassword: password, sandbox })
      if (result.ok) {
        setPassword("")
        toast.success(merchant.configured ? "SSLCommerz account updated." : "SSLCommerz account saved. Now turn on Online payments above.")
      } else toast.error(result.error)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4 text-primary" />
          Your SSLCommerz account
          {merchant.configured ? <Pill tone="green">Connected</Pill> : <Pill tone="gray">Not set up</Pill>}
        </CardTitle>
        <CardDescription>
          For customers paying online at your counter. Money goes to your own SSLCommerz account, which charges its own fee.
          Get one at developer.sslcommerz.com.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Store ID" htmlFor="m-store">
            <Input id="m-store" value={storeId} onChange={(e) => setStoreId(e.target.value)} autoComplete="off" />
          </Field>
          <Field
            label="Store password"
            htmlFor="m-pass"
            hint={merchant.hasPassword ? "Saved and encrypted. Leave empty to keep it." : "Stored encrypted. Only you can change it."}
          >
            <Input id="m-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <label className="flex items-center gap-3 text-sm sm:col-span-2">
            <Switch checked={sandbox} onCheckedChange={setSandbox} />
            Sandbox (test payments, no real money)
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending || !storeId.trim() || (!merchant.hasPassword && !password)}>
              {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
              {merchant.configured ? "Update account" : "Save account"}
            </Button>
            {merchant.configured && (
              <ConfirmAction
                trigger={
                  <Button type="button" variant="ghost" className="text-destructive">
                    <Trash2 />
                    Remove
                  </Button>
                }
                title="Remove the SSLCommerz account?"
                description="Online payments turn off. Cash, mobile banking and card keep working."
                confirmLabel="Remove"
                destructive
                onConfirm={async () => {
                  const result = await removeMerchantAccount()
                  if (result.ok) toast.success("SSLCommerz account removed")
                  else toast.error(result.error)
                  return result.ok
                }}
              />
            )}
          </div>
        </form>
      </CardContent>
    </Card>
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
          <p className="text-2xl font-semibold tabular-nums">{PRICE_LABEL}</p>
          <p className="text-sm text-muted-foreground">
            {business.status === "trial" ? "Free trial ends" : "Paid until"} {formatDate(endsAt)} · {daysLeft(endsAt)} days left
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
