import { addDays, differenceInCalendarDays } from "date-fns"
import type { Rental, RentalPlan } from "@/lib/types"

export const PLAN_LABEL: Record<RentalPlan, string> = {
  daily: "Per day",
  weekly: "Per week",
  monthly: "Per month",
  fixed: "Fixed price",
}

const PLAN_DAYS: Record<Exclude<RentalPlan, "fixed">, number> = { daily: 1, weekly: 7, monthly: 30 }
const PLAN_UNIT: Record<Exclude<RentalPlan, "fixed">, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
}

export interface RentalQuote {
  periods: number
  periodLabel: string
  subtotal: number
  total: number
  breakdown: string
}

/**
 * Weekly and monthly plans bill for every started period, so 10 days on a
 * weekly plan is 2 weeks. "fixed" is a flat price for the whole rental.
 */
export function quoteRental(plan: RentalPlan, rate: number, days: number, quantity: number): RentalQuote {
  const safeDays = Math.max(1, Math.floor(days || 1))
  const qty = Math.max(1, Math.floor(quantity || 1))
  const safeRate = Math.max(0, rate || 0)

  if (plan === "fixed") {
    const total = safeRate * qty
    return {
      periods: 1,
      periodLabel: `${safeDays} day${safeDays === 1 ? "" : "s"}`,
      subtotal: safeRate,
      total,
      breakdown: qty > 1 ? `${qty} × fixed price` : "Fixed price",
    }
  }

  const periods = Math.ceil(safeDays / PLAN_DAYS[plan])
  const [one, many] = PLAN_UNIT[plan]
  const periodLabel = `${periods} ${periods === 1 ? one : many}`
  const subtotal = periods * safeRate
  return {
    periods,
    periodLabel,
    subtotal,
    total: subtotal * qty,
    breakdown: `${periodLabel} × rate${qty > 1 ? ` × ${qty} units` : ""}`,
  }
}

export function rentalDueDate(rental: Pick<Rental, "startDate" | "days">) {
  return addDays(new Date(rental.startDate), rental.days)
}

/** Positive number = days overdue, negative = days remaining. */
export function rentalOverdueDays(rental: Pick<Rental, "startDate" | "days">, now = new Date()) {
  return differenceInCalendarDays(now, rentalDueDate(rental))
}

export function isOverdue(rental: Rental, now = new Date()) {
  return rental.status === "active" && rentalOverdueDays(rental, now) > 0
}
