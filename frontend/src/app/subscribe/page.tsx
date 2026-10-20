import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { AlertTriangle, CheckCircle2, LogOut, Store } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ManualPaymentNotice, PayOptions } from "@/components/billing"
import { requireOwner } from "@/lib/auth/dal"
import { accessEndsAt, priceLabel } from "@/lib/business"
import { getBillingConfig, listPayments } from "@/lib/billing/queries"
import { formatDate } from "@/lib/format"

export const metadata: Metadata = { title: "Subscribe" }

export default function SubscribePage({ searchParams }: PageProps<"/subscribe">) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-10">
      <Suspense>
        <Subscribe searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

async function Subscribe({ searchParams }: Pick<PageProps<"/subscribe">, "searchParams">) {
  const { user, business, locked } = await requireOwner()
  const { payment } = await searchParams
  // Not locked (e.g. a failed early renewal): the billing page handles it.
  if (!locked) redirect(payment ? `/billing?payment=${payment}` : "/billing")

  const [history, config] = await Promise.all([listPayments(), getBillingConfig()])
  const everPaid = history.some((p) => p.status === "paid")

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="flex items-center justify-center gap-2 text-sm font-medium">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Store className="size-4" />
        </span>
        {business.name}
      </div>
      <Card>
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <AlertTriangle className="size-5" />
          </div>
          <CardTitle className="text-xl">{everPaid ? "Your subscription has ended" : "Your free trial has ended"}</CardTitle>
          <CardDescription>
            {everPaid ? "It ran out" : "It ended"} on {formatDate(accessEndsAt(business))}, so {business.name} is locked for you and your team. Subscribe to get
            everything back right away. Nothing has been deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {payment === "failed" && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>The payment didn&apos;t go through and you weren&apos;t charged. Please try again.</AlertDescription>
            </Alert>
          )}
          {payment === "cancelled" && (
            <Alert>
              <AlertTriangle />
              <AlertDescription>You cancelled the payment. You can try again whenever you&apos;re ready.</AlertDescription>
            </Alert>
          )}
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-3xl font-semibold tabular-nums">{priceLabel(config.monthlyPrice)}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              {["Every feature, no limits", "All your shops, warehouses and staff", "Invoice for every payment"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <ManualPaymentNotice payments={history} />
          <PayOptions config={config} label={`Subscribe · ${priceLabel(config.monthlyPrice)}`} />
        </CardContent>
      </Card>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Logged in as {user.email}</span>
        <Button variant="ghost" size="sm" render={<Link href="/logout" prefetch={false} />} nativeButton={false}>
          <LogOut />
          Log out
        </Button>
      </div>
      {everPaid && (
        <p className="text-center text-xs text-muted-foreground">
          Past invoices:{" "}
          {history
            .filter((p) => p.status === "paid")
            .slice(0, 3)
            .map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <Link href={`/invoice/${p.id}`} target="_blank" className="underline underline-offset-2">
                  {p.invoiceNo}
                </Link>
              </span>
            ))}
        </p>
      )}
    </div>
  )
}
