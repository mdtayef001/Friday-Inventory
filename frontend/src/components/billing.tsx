"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { AlertTriangle, Copy, DatabaseBackup, Download, Hourglass, Loader2, LockKeyhole, Phone, Send, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Field, SimpleSelect, useRequired } from "@/components/common"
import { useBusiness, useSessionUser } from "@/components/session-provider"
import { REMINDER_DAYS, accessEndsAt, daysLeft, formatTaka, priceLabel } from "@/lib/business"
import { sendManualPayment, startPayment, type ManualPaymentInput } from "@/lib/billing/actions"
import { formatDate } from "@/lib/format"
import type { BillingConfig, Payment, PaymentOptions, WalletKind } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Pay button. Sends the owner to SSLCommerz, which asks for any payment details itself. */
export function PayForm({ label, monthlyPrice }: { label?: string; monthlyPrice: number }) {
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
        {leaving ? "Opening SSLCommerz…" : (label ?? `Pay ${priceLabel(monthlyPrice)}`)}
      </Button>
      <p className="text-center text-xs text-muted-foreground">Secure payment by SSLCommerz: bKash, Nagad, Rocket, cards and internet banking.</p>
    </form>
  )
}

type ManualMethod = ManualPaymentInput["method"]
const MONTHS = [1, 3, 6, 12]
// What to press in the wallet app, by the kind of number it goes to.
const WALLET_ACTION: Record<WalletKind, string> = { personal: "Send Money", agent: "Cash Out", merchant: "Make Payment" }

/** Every way the owner can pay: online when it's on, and sending money by hand. */
export function PayOptions({ config, label }: { config: BillingConfig; label?: string }) {
  const { options } = config
  const manual = options.wallets.length > 0 || !!options.bank
  return (
    <div className="grid gap-4">
      {config.online && <PayForm label={label} monthlyPrice={config.monthlyPrice} />}
      {config.online && manual && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or send it yourself
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {manual && <ManualPayForm options={options} monthlyPrice={config.monthlyPrice} />}
      {!config.online && !manual && (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          To pay, contact support{options.contact ? ` on ${options.contact}` : ""} and we&apos;ll tell you how.
        </p>
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Copy"
      title="Copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        toast.success("Copied")
      }}
    >
      <Copy />
    </Button>
  )
}

/** Send money to one of the platform's wallets or its bank account, then give the transaction ID to check. */
export function ManualPayForm({ options, monthlyPrice }: { options: PaymentOptions; monthlyPrice: number }) {
  const methods: { id: ManualMethod; label: string }[] = [...options.wallets, ...(options.bank ? [{ id: "bank" as const, label: "Bank" }] : [])]
  const [method, setMethod] = useState<ManualMethod>(methods[0].id)
  const [months, setMonths] = useState("1")
  const [reference, setReference] = useState("")
  const [sentFrom, setSentFrom] = useState("")
  const [pending, startTransition] = useTransition()

  const bank = method === "bank" ? options.bank : null
  const wallet = options.wallets.find((w) => w.id === method)
  const amount = formatTaka(monthlyPrice * Number(months))
  const required = useRequired()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!required.check(!!reference.trim(), e)) return
    startTransition(async () => {
      const result = await sendManualPayment({ method, months: Number(months), reference, sentFrom })
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

      <Field label="How many months" htmlFor="pay-months" required>
        <SimpleSelect id="pay-months" value={months} onChange={setMonths} options={MONTHS.map((n) => ({ value: String(n), label: `${n} ${n === 1 ? "month" : "months"} · ${formatTaka(monthlyPrice * n)}` }))} />
      </Field>

      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        {wallet && (
          <>
            <p>
              In {wallet.label}, <span className="font-medium">{WALLET_ACTION[wallet.kind]}</span> <span className="font-semibold tabular-nums">{amount}</span> to this{" "}
              {wallet.kind} number:
            </p>
            <div className="mt-1 flex items-center gap-2">
              <p className="flex-1 font-mono text-base font-medium">{wallet.number}</p>
              <CopyButton text={wallet.number} />
            </div>
          </>
        )}
        {bank && (
          <>
            <p>
              Transfer <span className="font-semibold tabular-nums">{amount}</span> to:
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1">
              {(
                [
                  ["Bank", bank.name],
                  ["Account name", bank.accountName],
                  ["Account number", bank.accountNumber],
                  ["Branch", bank.branch],
                  ["Routing number", bank.routing],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className={cn("font-medium break-words", k !== "Bank" && k !== "Branch" && k !== "Account name" && "font-mono")}>{v}</dd>
                    {k === "Account number" || k === "Routing number" ? <CopyButton text={v} /> : <span />}
                  </div>
                ))}
            </dl>
          </>
        )}
      </div>

      <Field label={bank ? "Bank reference" : "Transaction ID (TrxID)"} htmlFor="pay-ref" required missing={required.shown && !reference.trim()} hint={bank ? "From your bank's receipt or app." : "In the SMS you got after sending."}>
        <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} className="font-mono" maxLength={100} />
      </Field>
      <Field label={bank ? "Sent from (account name)" : "Sent from (your number)"} htmlFor="pay-from">
        <Input id="pay-from" value={sentFrom} onChange={(e) => setSentFrom(e.target.value)} maxLength={100} inputMode={bank ? undefined : "tel"} />
      </Field>

      <Button type="submit" size="lg" className="h-11" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Send />}
        I&apos;ve sent {amount}
      </Button>
      {options.contact && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Phone className="size-3" />
          Questions? Call or WhatsApp {options.contact}
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
  // No reminders once they've cancelled, or while it's being deleted.
  if (user.role !== "owner" || left > REMINDER_DAYS || business.cancelledAt || business.status === "closing") return null

  const what = business.status === "trial" ? "Your free trial" : "Your subscription"
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1">
        {what} ends {left === 0 ? "today" : `in ${left} ${left === 1 ? "day" : "days"}`} ({formatDate(endsAt)}). After that, {business.name} locks until you pay.
      </span>
      <Button size="sm" render={<Link href="/billing" />} nativeButton={false}>
        {business.status === "trial" ? "Subscribe" : "Renew"} · {priceLabel(business.monthlyPrice)}
      </Button>
    </div>
  )
}

/**
 * Everything the business has, as one ZIP of spreadsheets that open in Excel. For the owner,
 * even while the business is locked; the super admin passes the business's own `href`.
 */
export function DownloadDataButton({
  href = "/api/backend/business/export/",
  label = "Download my data",
  ...props
}: { href?: string; label?: string } & React.ComponentProps<typeof Button>) {
  const [busy, setBusy] = useState(false)
  // Fetched rather than a plain link, so "try again in a few minutes" shows as a message, not a saved file.
  async function download() {
    setBusy(true)
    try {
      const res = await fetch(href)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        return void toast.error(body?.detail ?? "Couldn't prepare the download. Try again.")
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "data.zip"
      const url = URL.createObjectURL(await res.blob())
      const a = Object.assign(document.createElement("a"), { href: url, download: name })
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button type="button" variant="outline" onClick={download} disabled={busy} {...props}>
      {busy ? <Loader2 className="animate-spin" /> : <Download />}
      {busy ? "Preparing…" : label}
    </Button>
  )
}

/** On Billing and Settings: the owner can take their records with them at any time. */
export function YourDataCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="size-4 text-primary" />
          Your data
        </CardTitle>
        <CardDescription>
          Everything in {useBusiness().name}: products, stock, sales, purchases, suppliers, clients, rentals, orders, staff and the activity log. One
          ZIP file with a spreadsheet for each, which opens in Excel. It&apos;s yours, so you can download it whenever you like, even if your
          subscription runs out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DownloadDataButton />
      </CardContent>
    </Card>
  )
}
