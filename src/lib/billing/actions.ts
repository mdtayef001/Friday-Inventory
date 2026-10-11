"use server"

import { headers } from "next/headers"
import { z } from "zod"
import { requireOwner } from "@/lib/auth/dal"
import { createPendingPayment } from "./payments"
import { initPayment } from "./sslcommerz"

export type StartPaymentResult = { ok: true; url: string } | { ok: false; error: string }

const PhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^(\+?880|0)1[3-9]\d{8}$/, "Enter a valid Bangladeshi mobile number, e.g. 01712345678"))

/** Where SSLCommerz should send the owner back to. */
async function baseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "")
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}`
}

/** Owner only. Opens a payment for one month and returns the gateway page to send them to. */
export async function startPayment(phone: string): Promise<StartPaymentResult> {
  const { user, business } = await requireOwner()
  if (business.status === "suspended") return { ok: false, error: "This business is suspended. Please contact support." }
  const parsed = PhoneSchema.safeParse(phone)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }

  const payment = createPendingPayment(business.id, business.name, { name: user.name, email: user.email, phone: parsed.data })
  const result = await initPayment(payment, await baseUrl())
  return "url" in result ? { ok: true, url: result.url } : { ok: false, error: result.error }
}
