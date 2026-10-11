import { format, formatDistanceToNow } from "date-fns"

// Change these to match your business.
export const CURRENCY = "USD"
export const LOCALE = "en-US"

const money = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY })
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
