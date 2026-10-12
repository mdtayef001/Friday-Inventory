import { NextResponse, type NextRequest } from "next/server"
import { API_URL } from "@/lib/api/config"

// SSLCommerz posts here after a payment attempt:
//   success / fail / cancel: the owner's browser, then we send them back to the app
//   ipn: SSLCommerz's server, a backup in case the browser never comes back
// The posted fields are passed to Django, which never trusts them: a payment is
// only marked paid after Django confirms it with SSLCommerz directly.

const RESULTS = ["success", "fail", "cancel", "ipn"] as const
type Result = (typeof RESULTS)[number]

export async function POST(req: NextRequest, ctx: RouteContext<"/api/payments/sslcommerz/[result]">) {
  const { result } = await ctx.params
  if (!RESULTS.includes(result as Result)) return new NextResponse("Not found", { status: 404 })

  const form = await req.formData()
  const tranId = String(form.get("tran_id") ?? "")
  const valId = String(form.get("val_id") ?? "")

  let outcome = "failed"
  try {
    const res = await fetch(`${API_URL}/billing/sslcommerz/${result}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tranId, valId }),
      cache: "no-store",
    })
    if (res.ok) outcome = ((await res.json()) as { status: string }).status
  } catch (err) {
    console.error("Payment result couldn't reach the API:", err)
  }

  if (result === "ipn") return NextResponse.json({ received: true, status: outcome })

  // 303 turns the gateway's POST into a normal GET, so the login cookies come along.
  const back = outcome === "success" ? `/billing?payment=success&tran=${encodeURIComponent(tranId)}` : `/subscribe?payment=${outcome}`
  return NextResponse.redirect(new URL(back, req.nextUrl), 303)
}
