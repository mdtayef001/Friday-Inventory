"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { AlertTriangle, Copy, Hourglass, Loader2, LockKeyhole, Phone, Send, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, SimpleSelect } from "@/components/common"
import { useBusiness, useSessionUser } from "@/components/session-provider"
import { PRICE_LABEL, REMINDER_DAYS, SUBSCRIPTION, accessEndsAt, daysLeft, formatTaka } from "@/lib/business"
import { sendManualPayment, startPayment, type ManualPaymentInput } from "@/lib/billing/actions"
import { formatDate } from "@/lib/format"
import type { BillingConfig, Payment, PaymentAccounts } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Pay button. Sends the owner to SSLCommerz, which asks for any payment details itself. */
export function PayForm({ label }: { label?: string }) {
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  const [leaving, setLeaving] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    startTransition(async () => {
      const result = await startPayment()
      if (!result.ok) return setError(result.error)
      setLeaving(true)
      window.location.assign(result.url)
    })
  }

  const busy = pending || leaving
  return (
    <form onSubmit={submit} className="grid gap-3">
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="h-11" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
        {leaving ? "Opening SSLCommerz…" : (label ?? `Pay ${PRICE_LABEL}`)}
      </Button>
      <p className="text-center text-xs text-muted-foreground">Secure payment by SSLCommerz: bKash, Nagad, Rocket, cards and internet banking.</p>
    </form>
  )
}

type ManualMethod = ManualPaymentInput["method"]
const MANUAL: { id: ManualMethod; label: string }[] = [
  { id: "bkash", label: "bKash" },
  { id: "nagad", label: "Nagad" },
  { id: "rocket", label: "Rocket" },
  { id: "bank", label: "Bank" },
]
const MONTHS = [1, 3, 6, 12]

/** Every way the owner can pay: online when SSLCommerz is connected, and sending money by hand. */
export function PayOptions({ config, label }: { config: BillingConfig; label?: string }) {
  return (
    <div className="grid gap-4">
      {config.online && (
        <>
          <PayForm label={label} />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or send it yourself
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <ManualPayForm accounts={config.accounts} />
    </div>
  )
}

/** Send money to the platform's bKash, Nagad, Rocket or bank account, then give the transaction ID to check. */
export function ManualPayForm({ accounts }: { accounts: PaymentAccounts }) {
  const methods = MANUAL.filter((m) => accounts[m.id].trim())
  const [method, setMethod] = useState<ManualMethod | undefined>(methods[0]?.id)
  const [months, setMonths] = useState("1")
  const [reference, setReference] = useState("")
  const [sentFrom, setSentFrom] = useState("")
  const [pending, startTransition] = useTransition()

  if (!method) {
    return (
      <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
        To pay, contact support{accounts.contact ? ` on ${accounts.contact}` : ""} and we&apos;ll tell you where to send the money.
      </p>
    )
  }

  const bank = method === "bank"
  const amount = formatTaka(SUBSCRIPTION.price * Number(months))
  const account = accounts[method]
  const copy = async () => {
    await navigator.clipboard.writeText(account)
    toast.success("Copied")
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await sendManualPayment({ method: method!, months: Number(months), reference, sentFrom })
      if (!result.ok) return void toast.error(result.error)
      toast.success("Sent. We'll check it and unlock your months, usually within a day.")
      setReference("")
      setSentFrom("")
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How you'll pay">
        {methods.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={method === m.id}
            onClick={() => setMethod(m.id)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              method === m.id ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <Field label="How many months" htmlFor="pay-months">
        <SimpleSelect id="pay-months" value={months} onChange={setMonths} options={MONTHS.map((n) => ({ value: String(n), label: `${n} ${n === 1 ? "month" : "months"} · ${formatTaka(SUBSCRIPTION.price * n)}` }))} />
      </Field>

      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <p>
          {bank ? "Transfer" : "Send Money"} <span className="font-semibold tabular-nums">{amount}</span> to:
        </p>
        <div className="mt-1 flex items-start gap-2">
          <p className={cn("flex-1 font-medium break-words", bank ? "whitespace-pre-line" : "font-mono text-base")}>{account}</p>
          <Button type="button" variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy" title="Copy">
            <Copy />
          </Button>
        </div>
      </div>

      <Field label={bank ? "Bank reference" : "Transaction ID (TrxID)"} htmlFor="pay-ref" hint={bank ? "From your bank's receipt or app." : "In the SMS you got after sending."}>
        <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} className="font-mono" maxLength={100} required />
      </Field>
      <Field label={bank ? "Sent from (account name)" : "Sent from (your number)"} htmlFor="pay-from">
        <Input id="pay-from" value={sentFrom} onChange={(e) => setSentFrom(e.target.value)} maxLength={100} inputMode={bank ? undefined : "tel"} />
      </Field>

      <Button type="submit" size="lg" className="h-11" disabled={pending || !reference.trim()}>
        {pending ? <Loader2 className="animate-spin" /> : <Send />}
        I&apos;ve sent {amount}
      </Button>
      {accounts.contact && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Phone className="size-3" />
          Questions? Call or WhatsApp {accounts.contact}
        </p>
      )}
    </form>
  )
}

/** Payments sent by hand still being checked, and the latest one turned down, if it's the newest news. */
export function ManualPaymentNotice({ payments }: { payments: Payment[] }) {
  const waiting = payments.filter((p) => p.status === "awaiting")
  const latest = payments.find((p) => p.channel === "manual")
  if (waiting.length) {
    return (
      <Alert>
        <Hourglass />
        <AlertTitle>Waiting for approval</AlertTitle>
        <AlertDescription>
          {waiting.map((p) => (
            <span key={p.id} className="block">
              {formatTaka(p.amount)} by {p.method} (TrxID <span className="font-mono">{p.reference}</span>) for {p.months} {p.months === 1 ? "month" : "months"}, sent{" "}
              {formatDate(p.createdAt)}.
            </span>
          ))}
          We&apos;ll unlock it as soon as we&apos;ve checked the money arrived, usually within a day.
        </AlertDescription>
      </Alert>
    )
  }
  if (latest?.status === "rejected") {
    return (
      <Alert variant="destructive">
        <XCircle />
        <AlertTitle>Payment not approved</AlertTitle>
        <AlertDescription>
          We couldn&apos;t find {formatTaka(latest.amount)} by {latest.method} with TrxID <span className="font-mono">{latest.reference}</span>.
          {latest.note && ` ${latest.note}`} Check the ID and send it again, or contact support.
        </AlertDescription>
      </Alert>
    )
  }
  return null
}

/** Reminder bar for the owner when the trial or paid month is about to run out. */
export function SubscriptionBanner() {
  const user = useSessionUser()
  const business = useBusiness()
  const endsAt = accessEndsAt(business)
  const left = daysLeft(endsAt)
  if (user.role !== "owner" || left > REMINDER_DAYS) return null

  const what = business.status === "trial" ? "Your free trial" : "Your subscription"
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1">
        {what} ends {left === 0 ? "today" : `in ${left} ${left === 1 ? "day" : "days"}`} ({formatDate(endsAt)}). After that, {business.name} locks until you pay.
      </span>
      <Button size="sm" render={<Link href="/billing" />} nativeButton={false}>
        {business.status === "trial" ? "Subscribe" : "Renew"} · {PRICE_LABEL}
      </Button>
    </div>
  )
}
