import { Suspense } from "react"
import type { Metadata } from "next"
import { CheckCircle2, Clock, XCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = { title: "Payment", robots: { index: false, follow: false } }

// Where a customer's phone lands after paying at a shop's counter with SSLCommerz.
// The shop's screen updates by itself; this just tells the customer what happened.
export default function PaymentDonePage({ searchParams }: PageProps<"/pay/done">) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-10">
      <Suspense>
        <Done searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

async function Done({ searchParams }: Pick<PageProps<"/pay/done">, "searchParams">) {
  const { status, business } = await searchParams
  const shop = typeof business === "string" && business ? business : "the shop"
  const view =
    status === "success"
      ? { icon: <CheckCircle2 className="size-10 text-emerald-500" />, title: "Payment received", text: `Thank you! ${shop} can see your payment now. You can close this page.` }
      : status === "pending"
        ? { icon: <Clock className="size-10 text-amber-500" />, title: "Checking your payment", text: `It can take a moment. ${shop} will see it as soon as it's confirmed.` }
        : status === "cancelled"
          ? { icon: <XCircle className="size-10 text-muted-foreground" />, title: "Payment cancelled", text: "Nothing was charged. Ask at the counter if you'd like to try again." }
          : { icon: <XCircle className="size-10 text-destructive" />, title: "Payment didn't go through", text: "Nothing was charged. Ask at the counter to try again or pay another way." }
  return (
    <Card className="w-full max-w-sm text-center">
      <CardHeader className="justify-items-center">
        {view.icon}
        <CardTitle className="text-xl">{view.title}</CardTitle>
        <CardDescription>{view.text}</CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  )
}
