"use client"

import Link from "next/link"
import { Banknote, CreditCard, Globe, Smartphone, type LucideIcon } from "lucide-react"
import { useBusiness, usePermissions } from "@/components/session-provider"
import { PAYMENT_METHODS, enabledMethods } from "@/lib/business"
import type { PaymentMethod } from "@/lib/types"
import { cn } from "@/lib/utils"

const ICON: Record<PaymentMethod, LucideIcon> = { cash: Banknote, mobile: Smartphone, card: CreditCard, online: Globe }

/**
 * The payment methods the owner turned on, as big buttons. `allowOnline` false for rentals.
 * With only cash on there is nothing to choose, so it just says so, and points
 * whoever can change that to Settings.
 */
export function PaymentPicker({ value, onChange, allowOnline = true }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; allowOnline?: boolean }) {
  const business = useBusiness()
  const { canOpen } = usePermissions()
  const methods = enabledMethods(business.settings).filter((m) => allowOnline || m !== "online")
  if (methods.length === 1)
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
        <span className="inline-flex items-center gap-2">
          <Banknote className="size-4 text-muted-foreground" />
          Payment: <strong className="font-medium">Cash</strong>
        </span>
        {canOpen("/settings") && (
          <Link href="/settings" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Add bKash, card or online
          </Link>
        )}
      </div>
    )
  return (
    <div role="radiogroup" aria-label="Payment" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {methods.map((m) => {
        const Icon = ICON[m]
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            onClick={() => onChange(m)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border p-2 text-xs font-medium transition-colors",
              value === m ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "hover:bg-muted",
            )}
          >
            <Icon className="size-4" />
            {PAYMENT_METHODS[m].short}
          </button>
        )
      })}
    </div>
  )
}

/** The bKash / Nagad number to show the customer. */
export function useMobileNumber() {
  return useBusiness().settings.payments?.mobileNumber ?? ""
}
