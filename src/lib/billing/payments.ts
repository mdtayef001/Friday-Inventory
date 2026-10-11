import "server-only"
import { randomUUID } from "node:crypto"
import { addMonths } from "date-fns"
import { SUBSCRIPTION, accessEndsAt } from "@/lib/business"
import { DEMO_TENANT_ID, findBusiness, patchBusiness } from "@/lib/auth/tenants"
import type { Payment } from "@/lib/types"

// Temporary in-memory payment store for the frontend test. It resets when the
// dev server restarts. The Django backend will replace this module.

const day = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(Date.now() - days * day).toISOString()

function seed(): { payments: Map<string, Payment>; nextInvoice: number } {
  const demoPayer = { name: "Ayesha Rahman", email: "owner@friday.app", phone: "01711000000" }
  const urbanPayer = { name: "Jamal Uddin", email: "urban@friday.app", phone: "01811000000" }
  let n = 0
  const paid = (businessId: string, businessName: string, payer: Payment["payer"], start: number, method: string): Payment => {
    n += 1
    const id = randomUUID().slice(0, 8)
    return {
      id: `pay-${id}`,
      tranId: `FRI${id.toUpperCase()}`,
      businessId,
      businessName,
      amount: SUBSCRIPTION.price,
      currency: SUBSCRIPTION.currency,
      status: "paid",
      method,
      createdAt: ago(start),
      paidAt: ago(start),
      periodStart: ago(start),
      periodEnd: ago(start - 30),
      invoiceNo: invoiceNumber(n, ago(start)),
      valId: `SEED${id}`,
      bankTranId: `SEEDBANK${id}`,
      payer,
    }
  }
  const list: Payment[] = [
    paid(DEMO_TENANT_ID, "Friday Demo Store", demoPayer, 113, "bKash"),
    paid(DEMO_TENANT_ID, "Friday Demo Store", demoPayer, 72, "bKash"),
    paid(DEMO_TENANT_ID, "Friday Demo Store", demoPayer, 42, "VISA-Dutch Bangla Bank"),
    paid("b-urban", "Urban Party Rentals", urbanPayer, 38, "Nagad"),
    paid(DEMO_TENANT_ID, "Friday Demo Store", demoPayer, 12, "bKash"),
    {
      id: "pay-urbanfail",
      tranId: "FRIURBANFAIL",
      businessId: "b-urban",
      businessName: "Urban Party Rentals",
      amount: SUBSCRIPTION.price,
      currency: SUBSCRIPTION.currency,
      status: "failed",
      createdAt: ago(3),
      payer: urbanPayer,
    },
  ]
  return { payments: new Map(list.map((p) => [p.id, p])), nextInvoice: n + 1 }
}

function invoiceNumber(n: number, at: string) {
  return `INV-${new Date(at).getFullYear()}-${String(n).padStart(4, "0")}`
}

const globalStore = globalThis as unknown as { __fridayPayments?: ReturnType<typeof seed> }
const db = (globalStore.__fridayPayments ??= seed())

const copy = (p: Payment): Payment => structuredClone(p)

export function listPayments(businessId?: string): Payment[] {
  return [...db.payments.values()]
    .filter((p) => !businessId || p.businessId === businessId)
    .map(copy)
    .sort((a, b) => (b.paidAt ?? b.createdAt).localeCompare(a.paidAt ?? a.createdAt))
}

export function findPayment(id: string) {
  const p = db.payments.get(id)
  return p ? copy(p) : null
}

export function findByTranId(tranId: string) {
  const p = [...db.payments.values()].find((x) => x.tranId === tranId)
  return p ? copy(p) : null
}

export function createPendingPayment(businessId: string, businessName: string, payer: Payment["payer"]): Payment {
  const id = randomUUID().replace(/-/g, "").slice(0, 12)
  const payment: Payment = {
    id: `pay-${id.slice(0, 8)}`,
    tranId: `FRI${id.toUpperCase()}`,
    businessId,
    businessName,
    amount: SUBSCRIPTION.price,
    currency: SUBSCRIPTION.currency,
    status: "pending",
    createdAt: new Date().toISOString(),
    payer,
  }
  db.payments.set(payment.id, payment)
  return copy(payment)
}

/**
 * Called only after SSLCommerz has confirmed the payment server-to-server.
 * Safe to call twice (success redirect and IPN both arrive): the second call
 * changes nothing. The paid month starts when current access runs out, so
 * paying early never loses days.
 */
export function markPaid(tranId: string, details: { method?: string; valId: string; bankTranId?: string }) {
  const p = [...db.payments.values()].find((x) => x.tranId === tranId)
  if (!p) return null
  if (p.status === "paid") return copy(p)
  const business = findBusiness(p.businessId)
  if (!business) return null

  const now = new Date()
  const accessEnd = new Date(accessEndsAt(business))
  const start = accessEnd > now ? accessEnd : now
  const end = addMonths(start, 1)

  Object.assign(p, {
    status: "paid",
    paidAt: now.toISOString(),
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    invoiceNo: invoiceNumber(db.nextInvoice++, now.toISOString()),
    method: details.method || "SSLCommerz",
    valId: details.valId,
    bankTranId: details.bankTranId,
  } satisfies Partial<Payment>)
  patchBusiness(business.id, { paidUntil: end.toISOString() })
  return copy(p)
}

/** Failed or cancelled at the gateway. Only a pending payment can change. */
export function markUnpaid(tranId: string, status: "failed" | "cancelled") {
  const p = [...db.payments.values()].find((x) => x.tranId === tranId)
  if (p && p.status === "pending") p.status = status
  return p ? copy(p) : null
}

export function removeBusinessPayments(businessId: string) {
  for (const [id, p] of db.payments) if (p.businessId === businessId) db.payments.delete(id)
}
