"use server"

import { z } from "zod"
import { api } from "@/lib/api/server"
import { ApiError } from "@/lib/api/errors"
import { requireOwner } from "@/lib/auth/dal"

export type StartPaymentResult = { ok: true; url: string } | { ok: false; error: string }

const PhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^(\+?880|0)1[3-9]\d{8}$/, "Enter a valid Bangladeshi mobile number, e.g. 01712345678"))

/** Owner only. Django opens a payment for one month and returns the gateway page to send them to. */
export async function startPayment(phone: string): Promise<StartPaymentResult> {
  const { business } = await requireOwner()
  if (business.status === "suspended") return { ok: false, error: "This business is suspended. Please contact support." }
  const parsed = PhoneSchema.safeParse(phone)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  try {
    const { url } = await api<{ url: string }>("billing/checkout/", { method: "POST", body: { phone: parsed.data } })
    return { ok: true, url }
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message }
    throw err
  }
}
