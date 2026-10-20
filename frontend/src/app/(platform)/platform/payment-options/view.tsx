"use client"

import { useState, useTransition } from "react"
import { CreditCard, Landmark, Phone, Smartphone } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Field, PageBody, PageHeader, Pill, SimpleSelect } from "@/components/common"
import { savePaymentAccounts } from "@/lib/auth/platform-actions"
import type { PaymentAccounts, WalletId, WalletKind } from "@/lib/types"

const WALLETS: { id: WalletId; label: string }[] = [
  { id: "bkash", label: "bKash" },
  { id: "nagad", label: "Nagad" },
  { id: "rocket", label: "Rocket" },
  { id: "upay", label: "Upay" },
]
const KINDS: { value: WalletKind; label: string }[] = [
  { value: "personal", label: "Personal · they Send Money" },
  { value: "agent", label: "Agent · they Cash Out" },
  { value: "merchant", label: "Merchant · they Make Payment" },
]
const ONLINE = {
  connected: { label: "Connected", tone: "green" },
  test: { label: "Test mode, no real money", tone: "amber" },
  missing: { label: "Not connected", tone: "gray" },
} as const

/** Which ways to pay owners see, set once here for every business. */
export function PaymentOptionsView({ accounts, onlineStatus }: { accounts: PaymentAccounts; onlineStatus: keyof typeof ONLINE }) {
  const [form, setForm] = useState(accounts)
  const [pending, startTransition] = useTransition()
  const set = <K extends keyof PaymentAccounts>(key: K, value: PaymentAccounts[K]) => setForm((f) => ({ ...f, [key]: value }))
  const text = (key: keyof PaymentAccounts) => (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value as never)
  const changed = (Object.keys(form) as (keyof PaymentAccounts)[]).some((k) => form[k] !== accounts[k])
  const walletsSet = WALLETS.filter((w) => form[w.id].trim()).length
  const bankMissing = form.bankEnabled && !form.bankAccountNumber.trim()

  return (
    <PageBody className="max-w-4xl">
      <PageHeader title="Payment options" description="How owners can pay you. Set them once here and every business sees them on its Billing page." />

      <form
        className="grid gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          startTransition(async () => {
            const result = await savePaymentAccounts(form)
            if (result.ok) toast.success("Payment options saved")
            else toast.error(result.error)
          })
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="size-4 text-primary" />
              Online with SSLCommerz
            </CardTitle>
            <CardDescription>Owners pay by card, bKash or Nagad on SSLCommerz, and access comes back right away without you checking.</CardDescription>
            <CardAction>
              <Switch checked={form.onlineEnabled} onCheckedChange={(v) => set("onlineEnabled", v)} aria-label="Online with SSLCommerz" />
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 text-sm">
            <Pill tone={ONLINE[onlineStatus].tone}>{ONLINE[onlineStatus].label}</Pill>
            <span className="text-muted-foreground">
              {onlineStatus === "missing"
                ? "Owners won't see it until the SSLCommerz keys are set on the server, even when this is on."
                : onlineStatus === "test"
                  ? "Payments go through the test page, so no real money moves."
                  : "The keys are set on the server."}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="size-4 text-primary" />
              Mobile banking
            </CardTitle>
            <CardDescription>
              Owners send money to your number, then type the TrxID. You approve it on Payments once it arrives. Leave a number empty to hide that wallet.
            </CardDescription>
            <CardAction>
              <Switch checked={form.mobileEnabled} onCheckedChange={(v) => set("mobileEnabled", v)} aria-label="Mobile banking" />
            </CardAction>
          </CardHeader>
          {form.mobileEnabled && (
            <CardContent className="grid gap-3">
              {WALLETS.map((w) => (
                <div key={w.id} className="grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,16rem)] sm:items-center">
                  <label htmlFor={`w-${w.id}`} className="text-sm font-medium">
                    {w.label}
                  </label>
                  <Input id={`w-${w.id}`} value={form[w.id]} onChange={text(w.id)} placeholder="01XXXXXXXXX" inputMode="tel" maxLength={40} className="font-mono" />
                  <SimpleSelect value={form[`${w.id}Kind`]} onChange={(v) => set(`${w.id}Kind`, v as WalletKind)} options={KINDS} disabled={!form[w.id].trim()} />
                </div>
              ))}
              {walletsSet === 0 && <p className="text-sm text-amber-700 dark:text-amber-400">Add at least one number, or owners won&apos;t see mobile banking.</p>}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="size-4 text-primary" />
              Bank transfer
            </CardTitle>
            <CardDescription>Owners transfer to your account and type the bank reference. You approve it on Payments.</CardDescription>
            <CardAction>
              <Switch checked={form.bankEnabled} onCheckedChange={(v) => set("bankEnabled", v)} aria-label="Bank transfer" />
            </CardAction>
          </CardHeader>
          {form.bankEnabled && (
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank" htmlFor="bank-name">
                <Input id="bank-name" value={form.bankName} onChange={text("bankName")} placeholder="e.g. Dutch-Bangla Bank" maxLength={100} />
              </Field>
              <Field label="Branch" htmlFor="bank-branch">
                <Input id="bank-branch" value={form.bankBranch} onChange={text("bankBranch")} maxLength={100} />
              </Field>
              <Field label="Account name" htmlFor="bank-account-name">
                <Input id="bank-account-name" value={form.bankAccountName} onChange={text("bankAccountName")} maxLength={100} />
              </Field>
              <Field label="Account number" htmlFor="bank-account-number" required>
                <Input id="bank-account-number" value={form.bankAccountNumber} onChange={text("bankAccountNumber")} maxLength={40} className="font-mono" />
              </Field>
              <Field label="Routing number" htmlFor="bank-routing">
                <Input id="bank-routing" value={form.bankRouting} onChange={text("bankRouting")} maxLength={20} className="font-mono" />
              </Field>
              {bankMissing && <p className="self-end text-sm text-amber-700 sm:pb-2 dark:text-amber-400">Owners won&apos;t see the bank until the account number is filled in.</p>}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="size-4 text-primary" />
              Contact for payment questions
            </CardTitle>
            <CardDescription>Shown under the payment form, so owners can call or WhatsApp you.</CardDescription>
          </CardHeader>
          <CardContent>
            <Input value={form.contact} onChange={text("contact")} placeholder="e.g. 01XXXXXXXXX (WhatsApp)" maxLength={100} className="max-w-sm" aria-label="Contact for payment questions" />
          </CardContent>
        </Card>

        <div className="sticky bottom-4 flex justify-end">
          <Button type="submit" size="lg" disabled={pending || !changed} className="shadow-lg">
            Save payment options
          </Button>
        </div>
      </form>
    </PageBody>
  )
}
