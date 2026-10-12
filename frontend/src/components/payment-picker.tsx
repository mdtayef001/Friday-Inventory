"use client"

import { Banknote, CreditCard, Globe, Smartphone, type LucideIcon } from "lucide-react"
import { useBusiness } from "@/components/session-provider"
import { PAYMENT_METHODS, enabledMethods } from "@/lib/business"
import type { PaymentMethod } from "@/lib/types"
import { cn } from "@/lib/utils"

const ICON: Record<PaymentMethod, LucideIcon> = { cash: Banknote, mobile: Smartphone, card: CreditCard, online: Globe }

/** The payment methods the owner turned on, as big buttons. `allowOnline` false for rentals. */
export function PaymentPicker({ value, onChange, allowOnline = true }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; allowOnline?: boolean }) {
  const business = useBusiness()
  const methods = enabledMethods(business.settings).filter((m) => allowOnline || m !== "online")
  if (methods.length === 1) return null
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
