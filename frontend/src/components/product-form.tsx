"use client"

import { useMemo, useState } from "react"
import { Shuffle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { useStore, type ProductInput } from "@/lib/store"
import type { Product } from "@/lib/types"
import { attempt, Field, SimpleSelect } from "./common"
import { ScanButton } from "./scanner"
import { useScope, useSessionUser } from "./session-provider"

const UNITS = ["pcs", "box", "pack", "set", "roll", "kg", "g", "litre", "metre", "pair"]

function makeSku(category: string) {
  const prefix = (category.replace(/[^a-z]/gi, "").slice(0, 3) || "PRD").toUpperCase()
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`
}

const num = (v: string) => (v.trim() === "" ? undefined : Number(v))

export function ProductForm({
  product,
  defaultBarcode = "",
  defaultLocationId,
  onDone,
  onCancel,
}: {
  product?: Product
  defaultBarcode?: string
  defaultLocationId?: string
  onDone: (product: Product) => void
  onCancel?: () => void
}) {
  const user = useSessionUser()
  const { locations } = useScope()
  const products = useStore((s) => s.products)
  const addProduct = useStore((s) => s.addProduct)
  const updateProduct = useStore((s) => s.updateProduct)
  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products])

  const [form, setForm] = useState({
    name: product?.name ?? "",
    category: product?.category ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? defaultBarcode,
    unit: product?.unit ?? "pcs",
    price: product ? String(product.price) : "",
    cost: product ? String(product.cost) : "",
    lowStockThreshold: product ? String(product.lowStockThreshold) : "5",
    description: product?.description ?? "",
    rentable: product?.rentable ?? false,
    daily: product?.rentRates?.daily?.toString() ?? "",
    weekly: product?.rentRates?.weekly?.toString() ?? "",
    monthly: product?.rentRates?.monthly?.toString() ?? "",
    locationId: defaultLocationId ?? locations[0]?.id ?? "",
    quantity: "1",
  })
  const [error, setError] = useState("")
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    const price = Number(form.price)
    const cost = form.cost === "" ? 0 : Number(form.cost)
    const threshold = Number(form.lowStockThreshold)
    const quantity = Number(form.quantity)
    const rates = { daily: num(form.daily), weekly: num(form.weekly), monthly: num(form.monthly) }

    if (form.name.trim().length < 2) return setError("Enter a product name.")
    if (!form.category.trim()) return setError("Enter a category.")
    if (!Number.isFinite(price) || price < 0) return setError("Enter a valid selling price.")
    if (!Number.isFinite(cost) || cost < 0) return setError("Enter a valid cost price.")
    if (!Number.isInteger(threshold) || threshold < 0) return setError("Low-stock alert must be a whole number.")
    if (form.rentable && !Object.values(rates).some((r) => r !== undefined && r > 0)) {
      return setError("Add at least one rent price (per day, week or month).")
    }
    if (Object.values(rates).some((r) => r !== undefined && (!Number.isFinite(r) || r < 0))) {
      return setError("Rent prices must be valid numbers.")
    }
    if (!product && (!Number.isInteger(quantity) || quantity < 0)) return setError("Opening stock must be a whole number.")
    if (!product && quantity > 0 && !form.locationId) return setError("Choose where this stock is stored.")

    const input: ProductInput = {
      name: form.name.trim(),
      category: form.category.trim(),
      sku: form.sku.trim() || makeSku(form.category),
      barcode: form.barcode.trim() || undefined,
      unit: form.unit,
      price,
      cost,
      lowStockThreshold: threshold,
      description: form.description.trim() || undefined,
      rentable: form.rentable,
      rentRates: form.rentable ? rates : undefined,
    }

    let saved: Product | undefined
    const ok = attempt(() => {
      if (product) {
        updateProduct(product.id, input, user.name)
        saved = { ...product, ...input }
      } else {
        saved = addProduct(input, quantity > 0 ? { locationId: form.locationId, quantity } : null, user.name)
      }
    }, product ? "Product updated" : "Product added")
    if (ok && saved) onDone(saved)
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product name" htmlFor="name" className="sm:col-span-2">
          <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Cordless Drill 20V" autoFocus />
        </Field>
        <Field label="Category" htmlFor="category" hint="Pick an existing one or type a new category.">
          <Input id="category" list="categories" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Tools" />
          <datalist id="categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Unit" htmlFor="unit">
          <SimpleSelect id="unit" value={form.unit} onChange={(v) => set("unit", v)} options={UNITS.map((u) => ({ value: u, label: u }))} />
        </Field>
        <Field label="SKU" htmlFor="sku" hint="Leave empty to create one automatically.">
          <div className="flex gap-2">
            <Input id="sku" value={form.sku} onChange={(e) => set("sku", e.target.value.toUpperCase())} placeholder="Auto" className="font-mono" />
            <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => set("sku", makeSku(form.category))} aria-label="Generate SKU">
              <Shuffle />
            </Button>
          </div>
        </Field>
        <Field label="Barcode / QR code" htmlFor="barcode" hint="Optional. Scan it or type the number.">
          <div className="flex gap-2">
            <Input id="barcode" value={form.barcode} onChange={(e) => set("barcode", e.target.value)} placeholder="e.g. 8901234567011" className="font-mono" />
            <ScanButton onScan={(code) => set("barcode", code)} />
          </div>
        </Field>
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Selling price" htmlFor="price">
          <Input id="price" type="number" inputMode="decimal" min="0" step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Cost price" htmlFor="cost" hint="What you paid. Used for stock value.">
          <Input id="cost" type="number" inputMode="decimal" min="0" step="0.01" value={form.cost} onChange={(e) => set("cost", e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Low-stock alert at" htmlFor="threshold" hint="Warn when a location has this many or fewer.">
          <Input id="threshold" type="number" inputMode="numeric" min="0" step="1" value={form.lowStockThreshold} onChange={(e) => set("lowStockThreshold", e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="description" className="sm:col-span-3">
          <Textarea id="description" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional notes, size, colour, model…" rows={2} />
        </Field>
      </div>

      <div className="space-y-4 rounded-xl border p-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Available for rent</span>
            <span className="block text-xs text-muted-foreground">Set prices per day, week or month. You can also use a fixed price when renting.</span>
          </span>
          <Switch checked={form.rentable} onCheckedChange={(v) => set("rentable", v)} />
        </label>
        {form.rentable && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Per day" htmlFor="daily">
              <Input id="daily" type="number" min="0" step="0.01" value={form.daily} onChange={(e) => set("daily", e.target.value)} placeholder="—" />
            </Field>
            <Field label="Per week" htmlFor="weekly">
              <Input id="weekly" type="number" min="0" step="0.01" value={form.weekly} onChange={(e) => set("weekly", e.target.value)} placeholder="—" />
            </Field>
            <Field label="Per month" htmlFor="monthly">
              <Input id="monthly" type="number" min="0" step="0.01" value={form.monthly} onChange={(e) => set("monthly", e.target.value)} placeholder="—" />
            </Field>
          </div>
        )}
      </div>

      {!product && (
        <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
          <Field label="Opening stock" htmlFor="quantity">
            <Input id="quantity" type="number" inputMode="numeric" min="0" step="1" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
          </Field>
          <Field label="Stored at" htmlFor="location">
            <SimpleSelect
              id="location"
              value={form.locationId}
              onChange={(v) => set("locationId", v)}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
              placeholder="Choose location"
            />
          </Field>
        </div>
      )}

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="lg">
          {product ? "Save changes" : "Add product"}
        </Button>
      </div>
    </form>
  )
}
