import { NextResponse, type NextRequest } from "next/server"
import { findByTranId, markPaid, markUnpaid } from "@/lib/billing/payments"
import { validate } from "@/lib/billing/sslcommerz"

// SSLCommerz posts here after a payment attempt:
//   success / fail / cancel: the owner's browser, then we send them back to the app
//   ipn: SSLCommerz's server, a backup in case the browser never comes back
// The posted fields are never trusted: a payment is only marked paid after
// validate() confirms it with SSLCommerz directly.

const RESULTS = ["success", "fail", "cancel", "ipn"] as const
type Result = (typeof RESULTS)[number]

export async function POST(req: NextRequest, ctx: RouteContext<"/api/payments/sslcommerz/[result]">) {
  const { result } = await ctx.params
  if (!RESULTS.includes(result as Result)) return new NextResponse("Not found", { status: 404 })

  const form = await req.formData()
  const tranId = String(form.get("tran_id") ?? "")
  const valId = String(form.get("val_id") ?? "")
  const payment = tranId ? findByTranId(tranId) : null

  let outcome: "success" | "failed" | "cancelled" = "failed"
  if (payment) {
    if (payment.status === "paid") {
      outcome = "success"
    } else if ((result === "success" || result === "ipn") && valId) {
      const check = await validate(valId, payment)
      if (check.ok) {
        markPaid(tranId, { valId, method: check.method, bankTranId: check.bankTranId })
        outcome = "success"
      }
    } else if (result === "cancel") {
      markUnpaid(tranId, "cancelled")
      outcome = "cancelled"
    } else {
      markUnpaid(tranId, "failed")
    }
  }

  if (result === "ipn") return NextResponse.json({ received: true, status: outcome })

  // 303 turns the gateway's POST into a normal GET, so the session cookie comes along.
  const back = outcome === "success" ? `/billing?payment=success&tran=${encodeURIComponent(tranId)}` : `/subscribe?payment=${outcome}`
  return NextResponse.redirect(new URL(back, req.nextUrl), 303)
}
