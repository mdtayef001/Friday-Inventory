import type { Metadata } from "next"
import { Boxes, CalendarClock, ScanBarcode, Store, Truck } from "lucide-react"
import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Log in" }

const HIGHLIGHTS = [
  { icon: Boxes, text: "Live stock for every shop and warehouse" },
  { icon: ScanBarcode, text: "Add products with a QR or barcode scan" },
  { icon: Truck, text: "Track orders from pending to delivered" },
  { icon: CalendarClock, text: "Rentals with automatic price totals" },
]

export default function LoginPage() {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col p-6 md:p-10">
        <div className="flex items-center gap-2 font-semibold">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="size-4" />
          </div>
          Friday Inventory
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <LoginForm showDemoAccounts={process.env.NODE_ENV !== "production"} />
          </div>
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-center lg:p-14">
        <div className="absolute -top-24 -right-24 size-96 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-16 size-80 rounded-full bg-white/5" />
        <div className="relative max-w-md space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight">Everything you stock, in one place.</h2>
            <p className="text-primary-foreground/80">
              Products, outlets, deliveries and rentals, with the right view for every person on your team.
            </p>
          </div>
          <ul className="space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
