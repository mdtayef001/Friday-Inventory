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
 * Per day: the days minus holidays. Weekly and monthly bill every started period (10 days on a weekly plan is
 * 2 weeks) and ignore holidays. "fixed" is a flat price for the whole rental. Same as Rental.quote in Django.
 */
export function quoteRental(plan: RentalPlan, rate: number, days: number, quantity: number, holidays = 0): RentalQuote {
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

  const off = plan === "daily" ? Math.min(Math.max(0, Math.floor(holidays || 0)), safeDays) : 0
  const periods = plan === "daily" ? safeDays - off : Math.ceil(safeDays / PLAN_DAYS[plan])
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

/** Days out, counting any started day (out at 10:00, back 10:00 next day = 1). At least 1. Same as Django. */
export function countDays(start: string | Date, end: Date = new Date()) {
  return Math.max(1, Math.ceil((end.getTime() - new Date(start).getTime()) / 86_400_000))
}

/** When it's expected back, or null for an open-ended rental. */
export function rentalDueDate(rental: Pick<Rental, "startDate" | "days">) {
  return rental.days ? addDays(new Date(rental.startDate), rental.days) : null
}

/** Positive = days overdue, negative = days remaining, null = no expected date. */
export function rentalOverdueDays(rental: Pick<Rental, "startDate" | "days">, now = new Date()) {
  const due = rentalDueDate(rental)
  return due ? differenceInCalendarDays(now, due) : null
}

export function isOverdue(rental: Rental, now = new Date()) {
  return rental.status === "active" && (rentalOverdueDays(rental, now) ?? 0) > 0
}
