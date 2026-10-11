import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CreditCard, FlaskConical, Smartphone, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatTaka } from "@/lib/business"
import { findByTranId } from "@/lib/billing/payments"
import { TEST_VAL_PREFIX, isTestGateway } from "@/lib/billing/sslcommerz"

export const metadata: Metadata = { title: "Test payment" }

// Stand-in for the SSLCommerz checkout page while no store credentials are set.
// It posts back exactly like SSLCommerz does, so the rest of the flow is real.
export default function TestGatewayPage({ params }: PageProps<"/pay/test/[tranId]">) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-10">
      <Suspense>
        <TestGateway params={params} />
      </Suspense>
    </main>
  )
}

async function TestGateway({ params }: Pick<PageProps<"/pay/test/[tranId]">, "params">) {
  const { tranId } = await params
  // After reading params, so this runs per request and not at build time.
  if (!isTestGateway()) notFound()
  const payment = findByTranId(decodeURIComponent(tranId))
  if (!payment || payment.status !== "pending") notFound()

  const fields = (result: string, method?: string) => (
    <>
      <input type="hidden" name="tran_id" value={payment.tranId} />
      {method && <input type="hidden" name="val_id" value={`${TEST_VAL_PREFIX}${method}-${crypto.randomUUID().slice(0, 8)}`} />}
      <input type="hidden" name="status" value={result === "success" ? "VALID" : result.toUpperCase()} />
    </>
  )
  const action = (result: string) => `/api/payments/sslcommerz/${result}`

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          <FlaskConical className="size-4 shrink-0" />
          Test gateway: SSLCommerz isn&apos;t connected yet, so no real money moves.
        </div>
        <CardTitle>Pay {formatTaka(payment.amount)}</CardTitle>
        <CardDescription>
          {payment.businessName} · monthly subscription · {payment.tranId}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {[
          { method: "bKash", icon: Smartphone },
          { method: "Nagad", icon: Smartphone },
          { method: "VISA", icon: CreditCard },
        ].map(({ method, icon: Icon }) => (
          <form key={method} method="post" action={action("success")}>
            {fields("success", method)}
            <Button type="submit" className="h-11 w-full justify-start" variant="outline">
              <Icon />
              Pay with {method}
            </Button>
          </form>
        ))}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <form method="post" action={action("fail")}>
            {fields("fail")}
            <Button type="submit" variant="ghost" className="w-full text-destructive">
              Simulate failure
            </Button>
          </form>
          <form method="post" action={action("cancel")}>
            {fields("cancel")}
            <Button type="submit" variant="ghost" className="w-full">
              <X />
              Cancel
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  )
}
