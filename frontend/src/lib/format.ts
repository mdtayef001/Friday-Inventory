import { format, formatDistanceToNow } from "date-fns"

export const LOCALE = "en-US"

// The currency is a per-business setting. <StoreGate> sets it before any
// money is shown, since all money is rendered on the client.

/** How each currency is written. Taka uses the Bangladeshi grouping (1,25,000) and hazar, lakh and crore. */
const CURRENCY_STYLE: Record<string, { locale: string; units: [number, string][] }> = {
  USD: { locale: "en-US", units: [[1e9, " billion"], [1e6, " million"], [1e3, "K"]] },
  BDT: { locale: "en-IN", units: [[1e7, " crore"], [1e5, " lakh"], [1e3, " hazar"]] },
}

let currency = "USD"
let money = moneyFormat("USD")
function moneyFormat(code: string) {
  // narrowSymbol: "৳" and "$" rather than "BDT" or "US$".
  return new Intl.NumberFormat(CURRENCY_STYLE[code]?.locale ?? LOCALE, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
}
export function setCurrency(code: string) {
  currency = code
  money = moneyFormat(code)
}
const number = new Intl.NumberFormat(LOCALE)

export const formatMoney = (value: number) => money.format(value)

/** For pages outside the app (receipts) that know the business's currency but don't run <StoreGate>. */
export const formatMoneyIn = (value: number, code: string) => moneyFormat(code).format(value)

/**
 * Big amounts in words, for totals: "$1.25 million", "$45.3K", "৳12.5 lakh", "৳3.2 crore".
 * Below 10,000 it's the full amount. Show formatMoney() too (e.g. on hover) where the exact figure matters.
 */
export function formatMoneyShort(value: number) {
  const abs = Math.abs(value)
  const units = CURRENCY_STYLE[currency]?.units ?? CURRENCY_STYLE.USD.units
  const unit = abs >= 10_000 ? units.find(([size]) => abs >= size) : undefined
  if (!unit) return money.format(value)
  const [size, name] = unit
  const scaled = abs / size
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
  const symbol = money.formatToParts(0).find((p) => p.type === "currency")?.value ?? ""
  const amount = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(scaled)
  return `${value < 0 ? "-" : ""}${symbol}${amount}${name}`
}
export const formatNumber = (value: number) => number.format(value)
export const formatDate = (iso: string) => format(new Date(iso), "MMM d, yyyy")
export const formatDateTime = (iso: string) => format(new Date(iso), "MMM d, yyyy · h:mm a")
export const timeAgo = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })

/**
 * Short payment method for tables: "VISA-Dutch Bangla Bank" -> "VISA",
 * "bKash (test)" -> "bKash". The invoice shows the full name.
 */
export function shortMethod(method?: string | null) {
  if (!method) return "—"
  return method.split(/\s*(?:·|\(|-)\s*/)[0].trim() || method
}

export function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

/** Short human-friendly reference like "SHP-4F2A9C". */
export function refCode(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`
}
