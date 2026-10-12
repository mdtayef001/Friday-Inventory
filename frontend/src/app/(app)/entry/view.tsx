"use client"

import { useState } from "react"
import { Camera, CheckCircle2, History, Keyboard, MapPin, Minus, Package, PackagePlus, Plus, SearchX, ShoppingCart, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAttempt, EmptyState, PageBody, PageHeader, SimpleSelect } from "@/components/common"
import { ProductForm } from "@/components/product-form"
import { CameraScanner, CodeInput } from "@/components/scanner"
import { usePermissions, useScope, useSessionUser } from "@/components/session-provider"
import { timeAgo } from "@/lib/format"
import { qtyAt, useStore } from "@/lib/store"
import { SellDialog } from "@/components/sell-dialog"
import type { Product } from "@/lib/types"

type Result = { kind: "found"; product: Product; code: string } | { kind: "new"; code: string } | { kind: "manual" } | null

export function EntryView() {
  const user = useSessionUser()
  const { locations } = useScope()
  const { canCreateProducts, canSell, canAddStock } = usePermissions()
  const products = useStore((s) => s.products)
  const activity = useStore((s) => s.activity)
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "")
  const [tab, setTab] = useState("camera")
  const [result, setResult] = useState<Result>(null)

  const myEntries = activity.filter((a) => a.user === user.name && /Stock added|Product added/.test(a.action)).slice(0, 8)

  function lookup(raw: string) {
    const code = raw.trim()
    const lower = code.toLowerCase()
    const product = products.find((p) => p.barcode === code || p.sku.toLowerCase() === lower)
    setResult(product ? { kind: "found", product, code } : { kind: "new", code })
  }

  if (locations.length === 0) {
    return (
      <PageBody>
        <EmptyState icon={MapPin} title="No location assigned" description="Ask your manager to assign you to a warehouse or shop before adding stock." />
      </PageBody>
    )
  }

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={`Hi ${user.name.split(" ")[0]}, what came in?`}
        description={
          canCreateProducts
            ? "Scan a QR code or barcode, type it, or add a new product by hand."
            : canAddStock && canSell
              ? "Scan a QR code or barcode, or type it, to add stock or sell."
              : canSell
                ? "Scan a QR code or barcode, or type it, to sell."
                : "Scan a QR code or barcode, or type it, to add stock."
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MapPin className="size-5" />
            </div>
            <div>
              <p className="text-sm font-medium">Adding stock to</p>
              <p className="text-xs text-muted-foreground">Everything you enter goes to this location.</p>
            </div>
          </div>
          <SimpleSelect
            value={locationId}
            onChange={setLocationId}
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
            className="h-10! sm:w-64"
          />
        </CardContent>
      </Card>

      {result?.kind === "found" ? (
        <FoundProduct product={result.product} locationId={locationId} onDone={() => setResult(null)} />
      ) : result && result.kind !== "manual" && !canCreateProducts ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <SearchX className="size-10 text-amber-500" />
            <p className="font-medium">
              No product uses <code className="font-mono">{result.code}</code>
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">Ask your manager or the owner to add this product first, then scan it again.</p>
            <Button variant="outline" onClick={() => setResult(null)}>
              Scan something else
            </Button>
          </CardContent>
        </Card>
      ) : result?.kind === "new" || result?.kind === "manual" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.kind === "new" ? <SearchX className="size-5 text-amber-500" /> : <PackagePlus className="size-5 text-primary" />}
              {result.kind === "new" ? "New code: create the product" : "Add a new product"}
            </CardTitle>
            <CardDescription>
              {result.kind === "new" ? (
                <>
                  No product uses <code className="font-mono">{result.code}</code> yet. Fill in the details and it will be saved with this code.
                </>
              ) : (
                "Fill in the details below."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProductForm
              key={result.kind === "new" ? result.code : "manual"}
              defaultBarcode={result.kind === "new" ? result.code : ""}
              defaultLocationId={locationId}
              onDone={() => setResult(null)}
              onCancel={() => setResult(null)}
            />
          </CardContent>
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <TabsList className={`grid h-auto! w-full ${canCreateProducts ? "grid-cols-3" : "grid-cols-2"}`}>
            <TabsTrigger value="camera" className="py-2">
              <Camera />
              <span className="hidden sm:inline">Scan with</span> camera
            </TabsTrigger>
            <TabsTrigger value="type" className="py-2">
              <Keyboard />
              Type code
            </TabsTrigger>
            {canCreateProducts && (
              <TabsTrigger value="manual" className="py-2">
                <PackagePlus />
                New product
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="camera" className="mt-4">
            <Card>
              <CardContent className="mx-auto w-full max-w-lg">
                {tab === "camera" && <CameraScanner onDetected={lookup} />}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="type" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Type or use a USB scanner</CardTitle>
                <CardDescription>Enter a barcode or SKU. Handheld scanners work here too: click the box and scan.</CardDescription>
              </CardHeader>
              <CardContent>
                <CodeInput onSubmit={lookup} autoFocus />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="manual" className="mt-4">
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                <PackagePlus className="size-10 text-muted-foreground" />
                <p className="max-w-sm text-sm text-muted-foreground">No barcode? Create the product by hand. A SKU and QR label will be generated for you.</p>
                <Button size="lg" onClick={() => setResult({ kind: "manual" })}>
                  <Plus />
                  Add new product
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" />
            Your recent entries
          </CardTitle>
        </CardHeader>
        <CardContent>
          {myEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet. Your entries will show up here.</p>
          ) : (
            <ul className="divide-y">
              {myEntries.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div className="flex min-w-0 items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    <span className="min-w-0">
                      <span className="font-medium">{a.action}</span>
                      <span className="block truncate text-muted-foreground">{a.detail}</span>
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageBody>
  )
}

function FoundProduct({ product, locationId, onDone }: { product: Product; locationId: string; onDone: () => void }) {
  const { canSell, canAddStock } = usePermissions()
  const stock = useStore((s) => s.stock)
  const locationName = useStore((s) => s.locations.find((l) => l.id === locationId)?.name)
  const adjustStock = useStore((s) => s.adjustStock)
  const [quantity, setQuantity] = useState(1)
  const [selling, setSelling] = useState(false)
  const current = qtyAt(stock, product.id, locationId)

  const [run, pending] = useAttempt()

  async function add() {
    const ok = await run(
      () => adjustStock(product.id, locationId, quantity, "Quick entry"),
      `Added ${quantity} ${product.unit} of ${product.name}`,
    )
    if (ok) onDone()
  }

  return (
    <Card className="ring-2 ring-emerald-500/40">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <Package className="size-6" />
            </div>
            <div>
              <CardTitle className="text-lg">{product.name}</CardTitle>
              <CardDescription>
                {product.category} · <span className="font-mono">{product.sku}</span>
              </CardDescription>
              <p className="mt-1 text-sm text-muted-foreground">
                {current} {product.unit} at {locationName} now
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onDone} aria-label="Cancel">
            <X />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-5 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-lg" className="size-12" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Less">
            <Minus />
          </Button>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="h-12 w-24 text-center text-xl font-semibold tabular-nums"
            aria-label="Quantity"
          />
          <Button variant="outline" size="icon-lg" className="size-12" onClick={() => setQuantity((q) => q + 1)} aria-label="More">
            <Plus />
          </Button>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {canSell && (
            <Button size="lg" variant={canAddStock ? "outline" : "default"} className="h-12 flex-1 px-6 text-base" onClick={() => setSelling(true)} disabled={current === 0}>
              <ShoppingCart />
              Sell
            </Button>
          )}
          {canAddStock && (
            <Button size="lg" className="h-12 flex-1 px-6 text-base" onClick={add} disabled={pending}>
              <PackagePlus />
              Add {quantity} {product.unit}
            </Button>
          )}
        </div>
      </CardContent>
      {selling && (
        <SellDialog productId={product.id} locationId={locationId} quantity={Math.min(quantity, current)} onClose={() => setSelling(false)} onSold={onDone} />
      )}
    </Card>
  )
}
