"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { AlertTriangle, Loader2, LockKeyhole } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useBusiness, useSessionUser } from "@/components/session-provider"
import { PRICE_LABEL, REMINDER_DAYS, accessEndsAt, daysLeft } from "@/lib/business"
import { startPayment } from "@/lib/billing/actions"
import { formatDate } from "@/lib/format"

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
