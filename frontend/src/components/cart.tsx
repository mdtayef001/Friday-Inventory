"use client"

import { createContext, useContext, useMemo, useState, useSyncExternalStore } from "react"
import { ShoppingCart, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CheckoutDialog, lineFor, type CheckoutLine } from "@/components/sell-dialog"
import { useSessionUser } from "@/components/session-provider"
import { formatMoney } from "@/lib/format"
import type { Product } from "@/lib/types"

interface Cart {
  lines: CheckoutLine[]
  /** The shop it's being rung up at, from the scan page. The checkout can change it. */
  locationId: string | null
}

const EMPTY: Cart = { lines: [], locationId: null }
const CHANGED = "friday:cart"
const memory = new Map<string, string | null>()

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange)
  return () => window.removeEventListener(CHANGED, onChange)
}

function read(key: string) {
  if (memory.has(key)) return memory.get(key) ?? null
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function parse(saved: string | null): Cart {
  try {
    const cart = JSON.parse(saved ?? "null") as Cart | null
    return cart && Array.isArray(cart.lines) ? cart : EMPTY
  } catch {
    return EMPTY
  }
}

const CartContext = createContext<{
  cart: Cart
  add: (product: Pick<Product, "id" | "name" | "price">, quantity: number, locationId?: string) => void
  setLines: (lines: CheckoutLine[]) => void
  clear: () => void
  /** Whether the checkout is open, and opens it. */
  checkingOut: boolean
  checkout: () => void
} | null>(null)

/**
 * Several products scanned into one bill, checked out together with one discount,
 * one payment and one receipt. Kept for this browser tab, per user, so it survives
 * moving between pages and a reload, but not a shared till's next login.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const key = `friday.cart.${useSessionUser().id}`
  // The cart lives in sessionStorage; this reads it, and re-reads it after each save.
  // The server has no storage, so it renders an empty cart.
  const saved = useSyncExternalStore(subscribe, () => read(key), () => null)
  const cart = useMemo(() => parse(saved), [saved])
  const [checkingOut, setCheckingOut] = useState(false)

  function save(next: Cart) {
    try {
      if (next.lines.length) sessionStorage.setItem(key, JSON.stringify(next))
      else sessionStorage.removeItem(key)
    } catch {
      // Private window or storage blocked: kept in memory for this page instead.
      memory.set(key, next.lines.length ? JSON.stringify(next) : null)
    }
    window.dispatchEvent(new Event(CHANGED))
  }

  const value = {
    cart,
    add(product: Pick<Product, "id" | "name" | "price">, quantity: number, locationId?: string) {
      const existing = cart.lines.findIndex((l) => l.productId === product.id)
      const lines =
        existing === -1
          ? [...cart.lines, lineFor(product, quantity)]
          : cart.lines.map((l, i) => (i === existing ? { ...l, quantity: l.quantity + quantity } : l))
      save({ lines, locationId: cart.locationId ?? locationId ?? null })
    },
    setLines: (lines: CheckoutLine[]) => save({ ...cart, lines }),
    clear: () => save(EMPTY),
    checkingOut,
    checkout: () => setCheckingOut(true),
  }

  return (
    <CartContext.Provider value={value}>
      {children}
      <CartBar onClose={() => setCheckingOut(false)} />
    </CartContext.Provider>
  )
}

export function useCart() {
  const cart = useContext(CartContext)
  if (!cart) throw new Error("useCart needs <CartProvider>")
  return cart
}

/** Adds a product to the cart and says so. */
export function useAddToCart() {
  const { add } = useCart()
  return (product: Pick<Product, "id" | "name" | "price">, quantity = 1, locationId?: string) => {
    add(product, quantity, locationId)
    toast.success(`${quantity} × ${product.name} added to the cart`)
  }
}

/** Shown at the bottom of every page while the cart has something in it. */
function CartBar({ onClose }: { onClose: () => void }) {
  const { cart, setLines, clear, checkingOut: open, checkout } = useCart()
  const units = cart.lines.reduce((n, l) => n + l.quantity, 0)
  const total = cart.lines.reduce((sum, l) => sum + l.quantity * (Number(l.unitPrice) || 0), 0)
  if (cart.lines.length === 0 && !open) return null

  return (
    <>
      {!open && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 print:hidden">
          <div className="pointer-events-auto flex w-full max-w-lg items-center gap-2 rounded-2xl border bg-background/95 p-2 pl-4 shadow-lg backdrop-blur">
            <ShoppingCart className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                {cart.lines.length} {cart.lines.length === 1 ? "item" : "items"} in the cart
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {units} {units === 1 ? "unit" : "units"} · {cart.lines.map((l) => l.name).join(", ")}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={clear} aria-label="Empty the cart">
              <Trash2 />
            </Button>
            <Button onClick={checkout}>
              Checkout
              <span className="tabular-nums">· {formatMoney(total)}</span>
            </Button>
          </div>
        </div>
      )}
      {open && (
        <CheckoutDialog
          lines={cart.lines}
          onLinesChange={setLines}
          initialLocation={cart.locationId ?? undefined}
          onClose={onClose}
          onSold={clear}
        />
      )}
    </>
  )
}
