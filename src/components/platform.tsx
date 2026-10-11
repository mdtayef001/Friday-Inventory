"use client"

import { Pill, type PillTone } from "@/components/common"
import type { BusinessStatus } from "@/lib/types"

export const STATUS: Record<BusinessStatus, { label: string; tone: PillTone }> = {
  active: { label: "Active", tone: "green" },
  trial: { label: "Trial", tone: "blue" },
  suspended: { label: "Suspended", tone: "red" },
}

export function BusinessStatusPill({ status }: { status: BusinessStatus }) {
  return <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill>
}

