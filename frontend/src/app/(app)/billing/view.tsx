"use client"

import Link from "next/link"
import { AlertTriangle, CalendarClock, CheckCircle2, FileText, FlaskConical } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageBody, PageHeader } from "@/components/common"
import { PayForm } from "@/components/billing"
import { BusinessStatusPill, PaymentsTable } from "@/components/platform"
import { useBusiness } from "@/components/session-provider"
import { PRICE_LABEL, REMINDER_DAYS, accessEndsAt, daysLeft } from "@/lib/business"
import { formatDate } from "@/lib/format"
import type { Payment } from "@/lib/types"

type Notice = { kind: "success"; paymentId: string; invoiceNo: string } | { kind: "failed" | "cancelled" } | null

export function BillingView({ payments, notice, testGateway }: { payments: Payment[]; notice: Notice; testGateway: boolean }) {
  const business = useBusiness()
  const endsAt = accessEndsAt(business)
  const left = daysLeft(endsAt)
  const onTrial = business.status === "trial"

  return (
    <PageBody className="max-w-5xl">
      <PageHeader title="Billing" description={`Your subscription is ${PRICE_LABEL}, everything included. Pay with SSLCommerz.`} />

      {notice?.kind === "success" && (
        <Alert className="border-green-600/30 bg-green-600/5">
          <CheckCircle2 className="text-green-600" />
          <AlertTitle>Payment received, thank you!</AlertTitle>
          <AlertDescription>
            Your subscription now runs until {formatDate(endsAt)}.{" "}
            <Link href={`/invoice/${notice.paymentId}`} target="_blank" className="font-medium underline underline-offset-2">
              View invoice {notice.invoiceNo}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {notice && notice.kind !== "success" && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>
            {notice.kind === "failed" ? "The payment didn't go through and you weren't charged." : "You cancelled the payment."} Your subscription hasn&apos;t
            changed.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" />
              Subscription
            </CardTitle>
            <CardDescription>{onTrial ? "You're on the free trial." : "Paid monthly. Pay before the end date to keep going without a break."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <BusinessStatusPill status={business.status} />
              <span className="text-sm text-muted-foreground">
                {onTrial ? "Trial ends" : "Paid until"} <span className="font-medium text-foreground">{formatDate(endsAt)}</span>
              </span>
            </div>
            <div>
              <p className="text-4xl font-semibold tabular-nums">{left}</p>
              <p className="text-sm text-muted-foreground">{left === 1 ? "day" : "days"} left</p>
            </div>
            {left <= REMINDER_DAYS && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                When this runs out, {business.name} locks for everyone until you pay. Your data is kept safe.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Paying early doesn&apos;t waste days: the new month starts when the current one ends.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{onTrial ? "Subscribe now" : "Pay for next month"}</CardTitle>
            <CardDescription>{PRICE_LABEL}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {testGateway && (
              <p className="flex items-start gap-2 rounded-lg bg-muted p-2 text-xs text-muted-foreground">
                <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
                SSLCommerz isn&apos;t connected yet, so this opens a test payment page. No real money moves.
              </p>
            )}
            <PayForm />
          </CardContent>
        </Card>
      </div>

      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            Payment history
          </CardTitle>
          <CardDescription>Open an invoice to print it or save it as a PDF.</CardDescription>
        </CardHeader>
        <PaymentsTable payments={payments} />
      </Card>

      <p className="text-sm text-muted-foreground">Need help with a payment? Contact support with your invoice or transaction number.</p>
    </PageBody>
  )
}
