"use server"

import { api } from "@/lib/api/server"
import { ApiError } from "@/lib/api/errors"
import { requireOwner } from "@/lib/auth/dal"

export type StartPaymentResult = { ok: true; url: string } | { ok: false; error: string }

/** Owner only. Django opens a payment for one month and returns the gateway page to send them to. */
export async function startPayment(): Promise<StartPaymentResult> {
  const { business } = await requireOwner()
  if (business.status === "suspended") return { ok: false, error: "This business is suspended. Please contact support." }
  try {
    const { url } = await api<{ url: string }>("billing/checkout/", { method: "POST", body: {} })
    return { ok: true, url }
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message }
    throw err
  }
}
