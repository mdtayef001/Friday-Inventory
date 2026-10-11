import { format, formatDistanceToNow } from "date-fns"

export const LOCALE = "en-US"

// The currency is a per-business setting. <StoreGate> sets it before any
// money is shown, since all money is rendered on the client.
let money = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "USD" })
export function setCurrency(code: string) {
  money = new Intl.NumberFormat(LOCALE, { style: "currency", currency: code })
}
const number = new Intl.NumberFormat(LOCALE)

export const formatMoney = (value: number) => money.format(value)
export const formatNumber = (value: number) => number.format(value)
export const formatDate = (iso: string) => format(new Date(iso), "MMM d, yyyy")
export const formatDateTime = (iso: string) => format(new Date(iso), "MMM d, yyyy · h:mm a")
export const timeAgo = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })

export function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

/** Short human-friendly reference like "SHP-4F2A9C". */
export function refCode(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`
}
