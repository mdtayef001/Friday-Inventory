"use client"

import { Pill, type PillTone } from "@/components/common"
import { PLANS } from "@/lib/plans"
import type { BusinessStatus, PlanId } from "@/lib/types"

export const STATUS: Record<BusinessStatus, { label: string; tone: PillTone }> = {
  active: { label: "Active", tone: "green" },
  trial: { label: "Trial", tone: "blue" },
  suspended: { label: "Suspended", tone: "red" },
}

export function BusinessStatusPill({ status }: { status: BusinessStatus }) {
  return <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill>
}

export function PlanPill({ plan }: { plan: PlanId }) {
  return <Pill tone={plan === "pro" ? "violet" : plan === "starter" ? "amber" : "gray"}>{PLANS[plan].name}</Pill>
}
