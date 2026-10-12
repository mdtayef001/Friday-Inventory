import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Check, PackageX, Phone, RotateCcw, Store } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { SHIPMENT_FLOW, SHIPMENT_STATUS, ShipmentStatusPill } from "@/components/status"
import { api } from "@/lib/api/server"
import { ApiError } from "@/lib/api/errors"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { PublicTracking, ShipmentStatus } from "@/lib/types"

// The client's order tracking link. No login: the long random token in the URL
// is the key, and Django only returns what the client should see.

export const metadata: Metadata = { title: "Track your order", robots: { index: false, follow: false } }

const HEADLINE: Record<ShipmentStatus, string> = {
  pending: "We've received your order",
  processing: "Your order is being prepared",
  in_delivery: "Your order is on its way",
  delivered: "Your order has been delivered",
  returned: "Your order was returned",
  cancelled: "Your order was cancelled",
}

export default function TrackPage({ params }: PageProps<"/track/[token]">) {
  return (
    <main className="flex min-h-svh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-md rounded-xl" />}>
        <Tracking params={params} />
      </Suspense>
    </main>
  )
}

async function Tracking({ params }: Pick<PageProps<"/track/[token]">, "params">) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) notFound()
  let order: PublicTracking
  try {
    order = await api<PublicTracking>(`track/${token}/`, { token: null })
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }

  const stopped = order.status === "cancelled" || order.status === "returned"
  const reached = SHIPMENT_FLOW.indexOf(order.status)
  const when = (status: ShipmentStatus) => order.history.findLast((e) => e.status === status)?.at

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="flex items-center justify-center gap-2 text-sm font-medium">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Store className="size-4" />
        </span>
        {order.businessName}
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-muted-foreground">{order.code}</span>
            <ShipmentStatusPill status={order.status} />
          </div>
          <CardTitle className="text-xl">{HEADLINE[order.status]}</CardTitle>
          <CardDescription>
            {order.quantity} × {order.productName || "Item"} · ordered {formatDateTime(order.createdAt)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {stopped ? (
            <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
              {order.status === "cancelled" ? <PackageX className="size-5 shrink-0 text-red-500" /> : <RotateCcw className="size-5 shrink-0 text-amber-500" />}
              <span>
                {SHIPMENT_STATUS[order.status].label} on {formatDateTime(when(order.status) ?? order.createdAt)}.
                {order.contactPhone && " Call us if you have any questions."}
              </span>
            </div>
          ) : (
            <ol className="relative space-y-5">
              {SHIPMENT_FLOW.map((step, i) => {
                const done = i <= reached
                const at = when(step)
                return (
                  <li key={step} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full border-2",
                          done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30 bg-background",
                        )}
                      >
                        {done && <Check className="size-3.5" />}
                      </span>
                      {i < SHIPMENT_FLOW.length - 1 && <span className={cn("mt-1 h-6 w-0.5 rounded-full", i < reached ? "bg-primary" : "bg-muted-foreground/20")} />}
                    </div>
                    <div className="-mt-0.5">
                      <p className={cn("text-sm font-medium", !done && "text-muted-foreground")}>{SHIPMENT_STATUS[step].label}</p>
                      {done && at && <p className="text-xs text-muted-foreground">{formatDateTime(at)}</p>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
          {order.contactPhone && (
            <Button variant="outline" className="w-full" render={<a href={`tel:${order.contactPhone.replace(/[^\d+]/g, "")}`} />} nativeButton={false}>
              <Phone />
              Call {order.businessName}
            </Button>
          )}
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">This page updates as your order moves. Keep the link to check again.</p>
    </div>
  )
}
