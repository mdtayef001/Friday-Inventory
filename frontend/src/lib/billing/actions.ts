"use server"

import { api, toResult, type ActionResult } from "@/lib/api/server"
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

export type ManualPaymentInput = { method: "bkash" | "nagad" | "rocket" | "bank"; months: number; reference: string; sentFrom: string }

/** Owner only. They sent money by hand; it waits for the super admin to check it arrived. */
export async function sendManualPayment(input: ManualPaymentInput): Promise<ActionResult> {
  await requireOwner()
  if (!input.reference?.trim()) return { ok: false, error: "Enter the transaction ID." }
  return toResult(() => api("billing/manual/", { method: "POST", body: input }))
}
