"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Loader2, Printer, ShoppingCart, XCircle } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ClientPicker } from "@/components/client-dialog"
import { Field, SimpleSelect, useAttempt } from "@/components/common"
import { PaymentPicker } from "@/components/payment-picker"
import { ReceiptShare } from "@/components/receipt-share"
import { useBusiness, usePermissions, useScope, useSessionUser } from "@/components/session-provider"
import { PAYMENT_METHODS } from "@/lib/business"
import { actions } from "@/lib/data/actions"
import { qtyAt, useProduct } from "@/lib/data/queries"
import { formatMoney } from "@/lib/format"
import type { ClientBrief, PaymentMethod, Product, Sale } from "@/lib/types"

/**
 * A walk-in sale: takes the stock and records the money at the price agreed now.
 * The price starts at the product's selling price and can be changed or discounted.
 * Online payments show a QR code and wait for SSLCommerz to confirm.
 * Once paid, it shows the receipt to print or send to the buyer.
 */
export function SellDialog({
  productId,
  locationId: initialLocation,
  quantity: initialQuantity = 1,
  onClose,
  onSold,
}: {
  productId: string
  locationId?: string
  quantity?: number
  onClose: () => void
  onSold?: () => void
}) {
  // Loaded fresh, so the stock shown is what's there now.
  const product = useProduct(productId).data
  if (!product) return null
  return <SellForm product={product} initialLocation={initialLocation} initialQuantity={initialQuantity} onClose={onClose} onSold={onSold} />
}

function SellForm({
  product,
  initialLocation,
  initialQuantity,
  onClose,
  onSold,
}: {
  product: Product
  initialLocation?: string
  initialQuantity: number
  onClose: () => void
  onSold?: () => void
}) {
  const user = useSessionUser()
  const { locations } = useScope()
  const [run, pending] = useAttempt()
  const showProfit = usePermissions().can("managerProfit")
  const [locationId, setLocationId] = useState(initialLocation ?? locations.find((l) => qtyAt(product, l.id) > 0)?.id ?? locations[0]?.id ?? "")
  const [quantity, setQuantity] = useState(String(initialQuantity))
  const [price, setPrice] = useState(String(product.price))
  const [discount, setDiscount] = useState("")
  const [client, setClient] = useState<ClientBrief | null>(null)
  const [method, setMethod] = useState<PaymentMethod>("cash")
  const [received, setReceived] = useState(false)
  const [reference, setReference] = useState("")
  const [online, setOnline] = useState<Sale | null>(null)
  const [sold, setSold] = useState<Sale | null>(null)
  // Called on the way out, not straight after the sale: the scan page unmounts this dialog in onSold.
  const finish = () => {
    onSold?.()
    onClose()
  }

  if (sold) return <Sold sale={sold} client={client} onDone={finish} />
  if (online) return <OnlinePayment sale={online} client={client} onClose={onClose} onPaid={finish} />

  const available = qtyAt(product, locationId)
  const qty = Number(quantity)
  const unitPrice = Number(price)
  const off = Number(discount) || 0
  const total = qty * unitPrice - off
  // Card machines are checked by a person, so they tick that it went through.
  // Mobile banking needs the transaction ID from the customer's payment instead.
  const needsConfirm = method === "card"
  const valid =
    !!locationId &&
    Number.isInteger(qty) &&
    qty > 0 &&
    qty <= available &&
    price !== "" &&
    unitPrice >= 0 &&
    off >= 0 &&
    total >= 0 &&
    (!needsConfirm || received) &&
    (method !== "mobile" || reference.trim() !== "") &&
    (method !== "online" || total > 0)
  // Staff don't see the client list, so they sell without one.
  const canPickClient = user.role !== "staff"

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    let sale: Sale | undefined
    // No toast: the Sold screen (or the online payment screen) says it went through.
    const ok = await run(async () => {
      sale = await actions.sell({ productId: product.id, locationId, quantity: qty, unitPrice, discount: off, clientId: client?.id, paymentMethod: method, paymentReference: method === "mobile" ? reference.trim() : undefined })
    })
    if (!ok || !sale) return
    if (sale.paymentStatus === "pending") return setOnline(sale)
    setSold(sale)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Sell</DialogTitle>
            <DialogDescription>{product.name}</DialogDescription>
          </DialogHeader>
          <Field label="Sold from" hint={`${available} ${product.unit} available here`}>
            <SimpleSelect value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Quantity" htmlFor="sell-qty">
              <Input id="sell-qty" type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
            </Field>
            <Field label="Price per unit" htmlFor="sell-price" hint={unitPrice !== product.price && price !== "" ? `List price ${formatMoney(product.price)}` : undefined}>
              <Input id="sell-price" type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
          </div>
          <Field label="Discount" htmlFor="sell-discount" hint="Taken off the total. Optional.">
            <Input id="sell-discount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          {canPickClient && (
            <Field label="Client" hint="Optional. Leave empty for a walk-in customer.">
              <ClientPicker value={client} onChange={setClient} />
            </Field>
          )}
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span className="tabular-nums">{Number.isFinite(total) ? formatMoney(Math.max(0, total)) : "—"}</span>
            </div>
            {showProfit && Number.isFinite(total) && qty > 0 && (
              <div className="mt-1 flex justify-between text-muted-foreground">
                <span>Profit</span>
                <span className="tabular-nums">{formatMoney(total - qty * product.cost)}</span>
              </div>
            )}
          </div>
          <PaymentPicker
            value={method}
            onChange={(m) => {
              setMethod(m)
              setReceived(false)
            }}
          />
          {method === "mobile" && (
            <Field label="Transaction ID" htmlFor="sell-trx" hint="From the bKash / Nagad payment message. It goes on the receipt.">
              <Input id="sell-trx" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} autoComplete="off" placeholder="e.g. 9AB3CD7XYZ" />
            </Field>
          )}
          {needsConfirm && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={received} onCheckedChange={(on) => setReceived(on === true)} />
              The card payment went through
            </label>
          )}
          {method === "online" && <p className="text-xs text-muted-foreground">Next, the customer scans a QR code and pays on their phone. The stock is held until it&apos;s paid.</p>}
          {qty > available && <p className="text-sm text-destructive">Only {available} available at this location.</p>}
          {off > qty * unitPrice && <p className="text-sm text-destructive">The discount can&apos;t be more than the total.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending ? <Loader2 className="animate-spin" /> : <ShoppingCart />}
              {method === "online" ? "Get payment QR" : "Sell"} {Number.isFinite(total) && total >= 0 ? `· ${formatMoney(total)}` : ""}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The sale went through: the receipt to print or send. */
function Sold({ sale, client, onDone }: { sale: Sale; client: ClientBrief | null; onDone: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sold</DialogTitle>
          <DialogDescription>
            {sale.quantity} × {sale.productName} · {formatMoney(sale.revenue)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid justify-items-center gap-2 py-2 text-center">
          <CheckCircle2 className="size-10 text-emerald-500" />
          {sale.paymentMethod && (
            <p className="text-sm">
              Paid by {PAYMENT_METHODS[sale.paymentMethod].short.toLowerCase()}
              {sale.paymentReference && <span className="font-mono"> · {sale.paymentReference}</span>}.
            </p>
          )}
        </div>
        <ReceiptActions sale={sale} client={client} />
        <DialogFooter>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Print the receipt, or send the buyer its link. Nothing until the sale is paid and numbered. */
function ReceiptActions({ sale, client }: { sale: Sale; client: ClientBrief | null }) {
  const business = useBusiness()
  if (!sale.receiptNo || !sale.receiptToken) return null
  return (
    <div className="grid gap-3">
      <Button variant="outline" render={<Link href={`/receipt/${sale.id}`} target="_blank" />} nativeButton={false}>
        <Printer />
        Print receipt {sale.receiptNo}
      </Button>
      <ReceiptShare token={sale.receiptToken} receiptNo={sale.receiptNo} businessName={business.name} client={client} />
    </div>
  )
}

/** Shows the SSLCommerz link as a QR code and checks every few seconds until it's paid, failed or cancelled. */
function OnlinePayment({ sale: initial, client, onClose, onPaid }: { sale: Sale; client: ClientBrief | null; onClose: () => void; onPaid: () => void }) {
  const { checkSale, cancelOnlinePayment } = actions
  const [sale, setSale] = useState(initial)
  const [cancelling, setCancelling] = useState(false)
  const url = initial.paymentUrl ?? ""
  const status = sale.paymentStatus

  useEffect(() => {
    if (status !== "pending") return
    const timer = setInterval(() => {
      checkSale(sale.id).then(setSale, () => undefined)
    }, 3000)
    return () => clearInterval(timer)
  }, [status, sale.id, checkSale])

  useEffect(() => {
    if (status === "paid") toast.success(`Paid online: ${sale.quantity} × ${sale.productName} for ${formatMoney(sale.revenue)}`)
  }, [status, sale.quantity, sale.productName, sale.revenue])

  async function cancel() {
    setCancelling(true)
    try {
      await cancelOnlinePayment(sale.id)
      toast("Online payment cancelled. The stock is back.")
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel.")
      setCancelling(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && status !== "pending" && onClose()}>
      <DialogContent className={status === "paid" ? "max-h-[92svh] overflow-y-auto sm:max-w-md" : "sm:max-w-sm"}>
        <DialogHeader>
          <DialogTitle>{status === "paid" ? "Paid" : status === "pending" ? "Scan to pay" : "Not paid"}</DialogTitle>
          <DialogDescription>
            {sale.quantity} × {sale.productName} · {formatMoney(sale.revenue)}
          </DialogDescription>
        </DialogHeader>
        {status === "pending" ? (
          <div className="grid justify-items-center gap-3 text-center">
            <div className="rounded-xl bg-white p-3 ring-1 ring-border">
              <QRCodeSVG value={url} size={200} />
            </div>
            <p className="text-sm text-muted-foreground">The customer scans this with their phone camera and pays with bKash, Nagad or a card.</p>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs underline underline-offset-2">
              Or open the payment page here
            </a>
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" />
              Waiting for payment…
            </p>
          </div>
        ) : status === "paid" ? (
          <>
            <div className="grid justify-items-center gap-2 py-4 text-center">
              <CheckCircle2 className="size-10 text-emerald-500" />
              <p className="text-sm">Confirmed by SSLCommerz{sale.gatewayMethod ? ` · ${sale.gatewayMethod}` : ""}.</p>
            </div>
            <ReceiptActions sale={sale} client={client} />
          </>
        ) : (
          <div className="grid justify-items-center gap-2 py-4 text-center">
            <XCircle className="size-10 text-destructive" />
            <p className="text-sm">The payment {status === "failed" ? "failed" : "was cancelled"}. The stock is back on the shelf.</p>
          </div>
        )}
        <DialogFooter>
          {status === "pending" ? (
            <Button variant="outline" onClick={cancel} disabled={cancelling}>
              {cancelling && <Loader2 className="animate-spin" />}
              Cancel payment
            </Button>
          ) : (
            <Button onClick={status === "paid" ? onPaid : onClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
