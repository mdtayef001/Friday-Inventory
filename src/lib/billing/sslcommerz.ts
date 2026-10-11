import "server-only"
import type { Payment } from "@/lib/types"

// SSLCommerz payment gateway (https://developer.sslcommerz.com).
//
// Flow: initPayment() opens a session and returns the gateway URL the owner is
// sent to. After paying, SSLCommerz POSTs the owner's browser back to our
// success / fail / cancel URLs, and separately calls the IPN URL. Neither POST
// is trusted on its own: validate() asks SSLCommerz directly whether the val_id
// is genuine, and checks the amount, currency and transaction id match.
//
// With no SSLCOMMERZ_STORE_ID set, development uses a built-in test gateway at
// /pay/test so the flow can be tried without an account. A production build
// refuses to start payments without real credentials, unless
// PAYMENTS_TEST_GATEWAY=true is set for testing (never set it on a live site).

const sandbox = process.env.SSLCOMMERZ_SANDBOX !== "false"
const HOST = sandbox ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com"

function credentials() {
  const storeId = process.env.SSLCOMMERZ_STORE_ID
  const storePassword = process.env.SSLCOMMERZ_STORE_PASSWORD
  return storeId && storePassword ? { storeId, storePassword } : null
}

/** True when payments go through the built-in test gateway instead of SSLCommerz. */
export function isTestGateway() {
  return !credentials() && (process.env.NODE_ENV !== "production" || process.env.PAYMENTS_TEST_GATEWAY === "true")
}

export const TEST_VAL_PREFIX = "TEST-"

export async function initPayment(payment: Payment, baseUrl: string): Promise<{ url: string } | { error: string }> {
  const creds = credentials()
  if (!creds) {
    if (!isTestGateway()) return { error: "Online payment isn't configured yet. Please contact support." }
    return { url: `${baseUrl}/pay/test/${encodeURIComponent(payment.tranId)}` }
  }

  const callback = (result: string) => `${baseUrl}/api/payments/sslcommerz/${result}`
  const body = new URLSearchParams({
    store_id: creds.storeId,
    store_passwd: creds.storePassword,
    total_amount: payment.amount.toFixed(2),
    currency: payment.currency,
    tran_id: payment.tranId,
    success_url: callback("success"),
    fail_url: callback("fail"),
    cancel_url: callback("cancel"),
    ipn_url: callback("ipn"),
    cus_name: payment.payer.name,
    cus_email: payment.payer.email,
    cus_phone: payment.payer.phone,
    cus_add1: payment.businessName,
    cus_city: "Dhaka",
    cus_country: "Bangladesh",
    shipping_method: "NO",
    num_of_item: "1",
    product_name: "Friday Inventory monthly subscription",
    product_category: "Software subscription",
    product_profile: "non-physical-goods",
    value_a: payment.businessId,
  })

  try {
    const res = await fetch(`${HOST}/gwprocess/v4/api.php`, { method: "POST", body, cache: "no-store" })
    const data = (await res.json()) as { status?: string; GatewayPageURL?: string; failedreason?: string }
    if (data.status === "SUCCESS" && data.GatewayPageURL) return { url: data.GatewayPageURL }
    console.error("SSLCommerz init failed:", data.failedreason ?? data.status)
    return { error: "The payment gateway couldn't start the payment. Please try again in a moment." }
  } catch (err) {
    console.error("SSLCommerz init error:", err)
    return { error: "Couldn't reach the payment gateway. Check your connection and try again." }
  }
}

export interface Validation {
  ok: boolean
  method?: string
  bankTranId?: string
}

/** Ask SSLCommerz whether this val_id is a real, completed payment for this transaction. */
export async function validate(valId: string, payment: Payment): Promise<Validation> {
  const creds = credentials()
  if (!creds) {
    // Test gateway: accept only its own val_ids ("TEST-<method>-<random>"), and never in production.
    const ok = isTestGateway() && valId.startsWith(TEST_VAL_PREFIX)
    return { ok, method: ok ? `${valId.split("-")[1]} (test)` : undefined, bankTranId: ok ? `TESTBANK${Date.now()}` : undefined }
  }

  const url = new URL(`${HOST}/validator/api/validationserverAPI.php`)
  url.search = new URLSearchParams({ val_id: valId, store_id: creds.storeId, store_passwd: creds.storePassword, v: "1", format: "json" }).toString()
  try {
    const res = await fetch(url, { cache: "no-store" })
    const data = (await res.json()) as {
      status?: string
      tran_id?: string
      amount?: string
      currency_type?: string
      card_type?: string
      card_issuer?: string
      bank_tran_id?: string
    }
    const ok =
      (data.status === "VALID" || data.status === "VALIDATED") &&
      data.tran_id === payment.tranId &&
      Number(data.amount) === payment.amount &&
      data.currency_type === payment.currency
    if (!ok) console.error("SSLCommerz validation rejected:", { status: data.status, tran_id: data.tran_id, amount: data.amount })
    return { ok, method: data.card_issuer ? `${data.card_type} · ${data.card_issuer}` : data.card_type, bankTranId: data.bank_tran_id }
  } catch (err) {
    console.error("SSLCommerz validation error:", err)
    return { ok: false }
  }
}
