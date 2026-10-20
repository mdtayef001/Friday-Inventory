"use client"

import { useEffect, useRef, useState } from "react"
import { format } from "date-fns"
import { Keyboard, Loader2, PackagePlus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, Pill, SimpleSelect, useAttempt } from "@/components/common"
import { UNITS } from "@/components/product-form"
import { ProductPicker } from "@/components/product-picker"
import { ScanButton } from "@/components/scanner"
import { usePermissions, useScope } from "@/components/session-provider"
import { SupplierPicker } from "@/components/supplier-dialog"
import { request } from "@/lib/api/client"
import { actions, type NewProductInput } from "@/lib/data/actions"
import { withParams } from "@/lib/data/queries"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Page, Product, SupplierBrief } from "@/lib/types"

/**
 * One product on the bill: an existing one, or a new one that's created when the
 * purchase is saved. The cost is kept as typed, so the field can be cleared while editing.
 */
type PayMode = "full" | "part" | "credit"
type PayMethod = "cash" | "mobile" | "bank"

const PAY_MODES: { value: PayMode; label: string }[] = [
  { value: "full", label: "Paid in full" },
  { value: "part", label: "Paid part" },
  { value: "credit", label: "On credit" },
]
export const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "mobile", label: "Mobile banking" },
  { value: "bank", label: "Bank" },
]

type PurchaseLine = { key: string; quantity: number; unitCost: string } & ({ product: Product; draft?: never } | { draft: NewProductInput; product?: never })

const today = () => format(new Date(), "yyyy-MM-dd")
let nextKey = 0

/**
 * Records stock bought from a supplier: the products and what was paid for each,
 * all received at one location. Saving puts them into stock there and averages
 * the price paid into each product's cost. Products bought for the first time can
 * be created right here, by name or by scanning their barcode.
 */
export function PurchaseDialog({ onClose, supplier: initialSupplier = null }: { onClose: () => void; supplier?: SupplierBrief | null }) {
  const { locations } = useScope()
  const { canCreateProducts } = usePermissions()
  const [run, pending] = useAttempt()
  const [supplier, setSupplier] = useState<SupplierBrief | null>(initialSupplier)
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "")
  const [lines, setLines] = useState<PurchaseLine[]>([])
  const [reference, setReference] = useState("")
  const [date, setDate] = useState(today)
  const [note, setNote] = useState("")
  const [creating, setCreating] = useState<NewProductInput | null>(null)
  // What was paid now. The rest is owed to the supplier.
  const [payMode, setPayMode] = useState<PayMode>("full")
  const [partPaid, setPartPaid] = useState("")
  const [payMethod, setPayMethod] = useState<PayMethod>("cash")
  const [dueDate, setDueDate] = useState("")
  // Scans are looked up one at a time, so a fast USB scanner can't add the same product twice.
  const queue = useRef(Promise.resolve())
  const linesNow = useRef(lines)
  useEffect(() => {
    linesNow.current = lines
  })

  const update = (key: string, patch: Partial<Pick<PurchaseLine, "quantity" | "unitCost">>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key))
  const newKey = () => `line-${nextKey++}`

  function addProduct(product: Product) {
    // The same product again adds one to its line instead of a second line.
    const same = linesNow.current.find((l) => l.product?.id === product.id)
    if (same) update(same.key, { quantity: same.quantity + 1 })
    else setLines((ls) => [...ls, { key: newKey(), product, quantity: 1, unitCost: String(product.cost) }])
  }

  function addDraft(draft: NewProductInput, quantity: number, unitCost: string) {
    setLines((ls) => [...ls, { key: newKey(), draft, quantity, unitCost }])
  }

  function scan(raw: string) {
    const code = raw.trim()
    if (code) queue.current = queue.current.then(() => find(code))
  }

  async function find(code: string) {
    // A new product already on this bill, scanned again.
    const draft = linesNow.current.find((l) => l.draft?.barcode && l.draft.barcode === code)
    if (draft) return update(draft.key, { quantity: draft.quantity + 1 })
    try {
      const { results } = await request<Page<Product>>(withParams("products/", { code, page: 1, pageSize: 1 }))
      if (results[0]) addProduct(results[0])
      else if (canCreateProducts) setCreating(looksLikeCode(code) ? { name: "", barcode: code } : { name: code })
      else toast.error(`No product matches ${code}. Ask the owner to add it first.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't look that up.")
    }
  }

  const total = lines.reduce((sum, l) => sum + l.quantity * Number(l.unitCost), 0)
  const paidNow = payMode === "full" ? total : payMode === "part" ? Number(partPaid) : 0
  const owed = Number.isFinite(total) && Number.isFinite(paidNow) ? Math.max(total - paidNow, 0) : 0
  // Credit needs someone to owe; part payment must be some but not all of the bill.
  const paymentOk =
    payMode === "full" || (!!supplier && (payMode === "credit" || (partPaid !== "" && paidNow > 0 && paidNow < total)) && (!dueDate || dueDate >= today()))
  const valid =
    !!locationId &&
    lines.length > 0 &&
    lines.every((l) => Number.isInteger(l.quantity) && l.quantity > 0 && l.unitCost !== "" && Number(l.unitCost) >= 0) &&
    !!date &&
    date <= today() &&
    paymentOk
  const newCount = lines.filter((l) => l.draft).length

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    const ok = await run(
      () =>
        actions.recordPurchase({
          supplierId: supplier?.id ?? null,
          locationId,
          items: lines.map((l) => {
            const paid = { quantity: l.quantity, unitCost: Number(l.unitCost) }
            return l.product ? { ...paid, productId: l.product.id } : { ...paid, newProduct: l.draft }
          }),
          reference: reference.trim(),
          note: note.trim(),
          // Today means now; an earlier day is recorded at midday so time zones can't move it a day.
          purchasedAt: date === today() ? undefined : new Date(`${date}T12:00:00`).toISOString(),
          paidAmount: payMode === "full" ? undefined : paidNow,
          paymentMethod: payMethod,
          dueDate: payMode !== "full" && dueDate ? dueDate : undefined,
        }),
      newCount ? `Purchase saved with ${newCount} new product${newCount > 1 ? "s" : ""}. The stock is in.` : "Purchase saved. The stock is in.",
    )
    if (ok) onClose()
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New purchase</DialogTitle>
              <DialogDescription>Stock you bought. It goes into stock where it arrives, and each product&apos;s cost is updated.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Supplier" hint="Optional.">
                <SupplierPicker value={supplier} onChange={setSupplier} allowNone />
              </Field>
              <Field label="Arrives at">
                <SimpleSelect value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
              </Field>
            </div>

            <Field label="Products" hint={canCreateProducts ? "Search, or scan a barcode. A product you don't have yet can be created here." : undefined}>
              <div className="flex gap-2">
                <ProductPicker
                  value={null}
                  onChange={addProduct}
                  placeholder="Add a product…"
                  describe={(p) => `Cost ${formatMoney(p.cost)}`}
                  onCreate={canCreateProducts ? (name) => setCreating({ name }) : undefined}
                  className="flex-1"
                />
                <ScanButton onScan={scan} />
              </div>
            </Field>
            <CodeBox onCode={scan} />

            {lines.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Add the products on the supplier&apos;s bill.</p>
            ) : (
              <ul className="grid gap-3">
                {lines.map((line, i) => (
                  <PurchaseRow key={line.key} index={i} line={line} onChange={(patch) => update(line.key, patch)} onRemove={() => remove(line.key)} />
                ))}
              </ul>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Supplier's bill number" htmlFor="pur-ref" hint="Optional.">
                <Input id="pur-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} autoComplete="off" placeholder="e.g. INV-1182" />
              </Field>
              <Field label="Date bought" htmlFor="pur-date">
                <Input id="pur-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Note" htmlFor="pur-note" hint="Optional." className="sm:col-span-2">
                <Input id="pur-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
              </Field>
            </div>

            <div className="grid gap-3 rounded-xl border bg-muted/30 p-3">
              <div className="flex justify-between text-sm font-medium">
                <span>Bill total</span>
                <span className="tabular-nums">{Number.isFinite(total) ? formatMoney(total) : "—"}</span>
              </div>
              <div role="radiogroup" aria-label="Payment" className="grid grid-cols-3 gap-2">
                {PAY_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={payMode === m.value}
                    onClick={() => setPayMode(m.value)}
                    className={cn(
                      "rounded-lg border bg-background px-2 py-1.5 text-xs font-medium transition-colors",
                      payMode === m.value ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "hover:bg-muted",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {payMode === "part" && (
                  <Field label="Paid now" htmlFor="pur-paid">
                    <Input id="pur-paid" type="number" inputMode="decimal" min="0.01" step="0.01" value={partPaid} onChange={(e) => setPartPaid(e.target.value)} />
                  </Field>
                )}
                {payMode !== "credit" && (
                  <Field label="Paid with" htmlFor="pur-method">
                    <SimpleSelect id="pur-method" value={payMethod} onChange={(v) => setPayMethod(v as PayMethod)} options={PAY_METHODS} />
                  </Field>
                )}
                {payMode !== "full" && (
                  <Field label="Rest due by" htmlFor="pur-due" hint="Optional.">
                    <Input id="pur-due" type="date" value={dueDate} min={today()} onChange={(e) => setDueDate(e.target.value)} />
                  </Field>
                )}
              </div>
              {payMode !== "full" &&
                (supplier ? (
                  <p className="text-sm">
                    You&apos;ll owe {supplier.name} <strong className="tabular-nums">{formatMoney(owed)}</strong>.
                    {payMode === "part" && partPaid !== "" && paidNow >= total && <span className="text-destructive"> That&apos;s all of it: choose Paid in full.</span>}
                  </p>
                ) : (
                  <p className="text-sm text-destructive">Choose the supplier above to buy on credit, so the app knows who you owe.</p>
                ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || pending}>
                {pending ? <Loader2 className="animate-spin" /> : <PackagePlus />}
                Save purchase {lines.length > 0 && Number.isFinite(total) ? `· ${formatMoney(total)}` : ""}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {creating && (
        <NewProductDialog
          initial={creating}
          takenBarcodes={lines.flatMap((l) => (l.draft?.barcode ? [l.draft.barcode] : []))}
          onClose={() => setCreating(null)}
          onAdd={(draft, quantity, unitCost) => {
            addDraft(draft, quantity, unitCost)
            setCreating(null)
          }}
        />
      )}
    </>
  )
}

/** A long run of digits (or one without spaces that has digits) is a barcode or SKU, not a product name. */
const looksLikeCode = (text: string) => /^\d{6,}$/.test(text) || (!/\s/.test(text) && /\d/.test(text) && text.length >= 6)

/**
 * For USB and Bluetooth scanners, which type the code and press Enter. Not a form of
 * its own (it sits inside the purchase form), so Enter is caught here.
 */
function CodeBox({ onCode }: { onCode: (code: string) => void }) {
  const [value, setValue] = useState("")
  return (
    <div className="relative">
      <Keyboard className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          if (value.trim()) onCode(value)
          setValue("")
        }}
        placeholder="Or type / scan a barcode or SKU and press Enter"
        aria-label="Barcode or SKU"
        className="pl-9 font-mono"
        autoComplete="off"
      />
    </div>
  )
}

function PurchaseRow({
  index,
  line,
  onChange,
  onRemove,
}: {
  index: number
  line: PurchaseLine
  onChange: (patch: Partial<Pick<PurchaseLine, "quantity" | "unitCost">>) => void
  onRemove: () => void
}) {
  const name = line.product?.name ?? line.draft?.name ?? ""
  const unit = line.product?.unit ?? line.draft?.unit ?? "pcs"
  return (
    <li className="grid gap-2 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            {name}
            {line.draft && <Pill tone="blue">New</Pill>}
          </p>
          <p className="text-xs text-muted-foreground">
            {line.product
              ? `${line.product.sku} · cost now ${formatMoney(line.product.cost)}`
              : `Created when you save${line.draft?.barcode ? ` · barcode ${line.draft.barcode}` : ""}${line.draft?.price ? ` · sells for ${formatMoney(line.draft.price)}` : ""}`}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${name}`}>
          <X />
        </Button>
      </div>
      <div className="grid grid-cols-[5rem_1fr] items-end gap-2">
        <Field label={`Qty (${unit})`} htmlFor={`pur-qty-${index}`}>
          <Input
            id={`pur-qty-${index}`}
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={line.quantity || ""}
            onChange={(e) => onChange({ quantity: Math.floor(Number(e.target.value)) || 0 })}
          />
        </Field>
        <Field label="Paid per unit" htmlFor={`pur-cost-${index}`}>
          <Input
            id={`pur-cost-${index}`}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={line.unitCost}
            onChange={(e) => onChange({ unitCost: e.target.value })}
          />
        </Field>
      </div>
    </li>
  )
}

/**
 * Just enough to add a product bought for the first time. A SKU is made automatically;
 * category, alerts and rental prices can be filled in later on the product's page.
 */
function NewProductDialog({
  initial,
  takenBarcodes,
  onClose,
  onAdd,
}: {
  initial: NewProductInput
  takenBarcodes: string[]
  onClose: () => void
  onAdd: (draft: NewProductInput, quantity: number, unitCost: string) => void
}) {
  const [name, setName] = useState(initial.name)
  const [unit, setUnit] = useState(initial.unit ?? "pcs")
  const [price, setPrice] = useState("")
  const [barcode, setBarcode] = useState(initial.barcode ?? "")
  const [quantity, setQuantity] = useState(1)
  const [unitCost, setUnitCost] = useState("")
  const taken = !!barcode.trim() && takenBarcodes.includes(barcode.trim())
  const valid = name.trim().length >= 2 && quantity > 0 && unitCost !== "" && Number(unitCost) >= 0 && (price === "" || Number(price) >= 0) && !taken

  function submit(e: React.FormEvent) {
    // Its own form inside the purchase dialog: don't let the submit reach the purchase.
    e.preventDefault()
    e.stopPropagation()
    if (!valid) return
    onAdd({ name: name.trim(), unit, price: price === "" ? undefined : Number(price), barcode: barcode.trim() || undefined }, quantity, unitCost)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New product</DialogTitle>
            <DialogDescription>It&apos;s created when you save the purchase. Add the rest later on its page.</DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="np-name">
            <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!initial.name} maxLength={200} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit" htmlFor="np-unit">
              <SimpleSelect id="np-unit" value={unit} onChange={setUnit} options={UNITS.map((u) => ({ value: u, label: u }))} />
            </Field>
            <Field label="Selling price" htmlFor="np-price" hint="Optional.">
              <Input id="np-price" type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
          </div>
          <Field label="Barcode" htmlFor="np-barcode" hint={taken ? "Another new product on this bill has this barcode." : "Optional. A SKU is made for you."}>
            <Input id="np-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} className="font-mono" aria-invalid={taken} maxLength={128} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Qty bought (${unit})`} htmlFor="np-qty">
              <Input
                id="np-qty"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={quantity || ""}
                onChange={(e) => setQuantity(Math.floor(Number(e.target.value)) || 0)}
              />
            </Field>
            <Field label="Paid per unit" htmlFor="np-cost">
              <Input
                id="np-cost"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                autoFocus={!!initial.name}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Add to purchase
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
