import "server-only"
import { api, apiOrNull } from "@/lib/api/server"
import type { Payment } from "@/lib/types"

/** The owner's own payments, newest first. */
export const listPayments = () => api<Payment[]>("billing/payments/")

/** One payment, if the caller is its business's owner or the super admin. */
export const findPayment = (id: string) => (/^\d+$/.test(id) ? apiOrNull<Payment>(`billing/payments/${id}/`) : Promise.resolve(null))

/** True when payments go through the built-in test gateway instead of SSLCommerz. */
export const isTestGateway = async () => (await api<{ testGateway: boolean }>("billing/config/")).testGateway

/** A pending payment for the test gateway page. Null unless the test gateway is on. */
export const findTestPayment = (tranId: string) =>
  apiOrNull<Payment>(`billing/test-gateway/${encodeURIComponent(tranId)}/`)

export const TEST_VAL_PREFIX = "TEST-"
