import { NextResponse, type NextRequest } from "next/server"
import { API_URL } from "@/lib/api/config"

// SSLCommerz posts here after a customer paid at a business's counter (the
// business's own SSLCommerz account):
//   success / fail / cancel: the customer's phone, then we show them a thank-you page
//   ipn: SSLCommerz's server, a backup in case the phone never comes back
// The fields go to Django, which only marks the sale paid after SSLCommerz confirms it.

const RESULTS = ["success", "fail", "cancel", "ipn"] as const
type Result = (typeof RESULTS)[number]

export async function POST(req: NextRequest, ctx: RouteContext<"/api/sale-payments/sslcommerz/[result]">) {
  const { result } = await ctx.params
  if (!RESULTS.includes(result as Result)) return new NextResponse("Not found", { status: 404 })

  const form = await req.formData()
  const tranId = String(form.get("tran_id") ?? "")
  const valId = String(form.get("val_id") ?? "")

  let outcome = "failed"
  let business = ""
  try {
    const res = await fetch(`${API_URL}/sale-payments/${result}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tranId, valId }),
      cache: "no-store",
    })
    if (res.ok) ({ status: outcome, business = "" } = (await res.json()) as { status: string; business?: string })
  } catch (err) {
    console.error("Sale payment result couldn't reach the API:", err)
  }

  if (result === "ipn") return NextResponse.json({ received: true, status: outcome })
  const params = new URLSearchParams({ status: outcome, ...(business && { business }) })
  return NextResponse.redirect(new URL(`/pay/done?${params}`, req.nextUrl), 303)
}
