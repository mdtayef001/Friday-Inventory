"use client"

import { useState } from "react"
import Link from "next/link"
import { MapPin, Pencil, Phone, Plus, Store, Trash2, Warehouse } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  attempt,
  useAttempt,
  useRequired,
  ConfirmAction,
  EmptyState,
  Field,
  PageBody,
  PageHeader,
  Pill,
  SimpleSelect,
  MoneyTotal,
} from "@/components/common"
import { usePermissions, useScope } from "@/components/session-provider"
import { actions } from "@/lib/data/actions"
import { useStockSummary } from "@/lib/data/queries"
import { formatNumber } from "@/lib/format"
import type { Location, LocationType } from "@/lib/types"

export function LocationsView() {
  const scope = useScope()
  const [editing, setEditing] = useState<Location | "new" | null>(null)
  // Owners add and delete locations; managers may edit their own if the owner allows it.
  const canEdit = usePermissions().can("managerLocations")
  const summary = useStockSummary().data
  const stats = new Map(summary?.locations.map((l) => [l.locationId, l]))

  const warehouses = scope.locations.filter((l) => l.type === "warehouse")
  const outlets = scope.locations.filter((l) => l.type === "outlet")

  const renderCard = (l: Location) => {
    const s = stats.get(l.id) ?? { units: 0, value: 0, products: 0, low: 0 }
    const Icon = l.type === "warehouse" ? Warehouse : Store
    return (
      <Card key={l.id} className="transition-shadow hover:shadow-md">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>
              <div>
                <CardTitle>
                  <Link href={`/locations/${l.id}`} className="hover:underline">
                    {l.name}
                  </Link>
                </CardTitle>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="size-3" />
                  {l.address}
                </p>
                {l.phone && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="size-3" />
                    {l.phone}
                  </p>
                )}
              </div>
            </div>
            {s.low > 0 && <Pill tone="amber">{s.low} low</Pill>}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-lg font-semibold tabular-nums">{formatNumber(s.products)}</p>
            <p className="text-xs text-muted-foreground">Products</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-lg font-semibold tabular-nums">{formatNumber(s.units)}</p>
            <p className="text-xs text-muted-foreground">Units</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="truncate text-lg font-semibold tabular-nums"><MoneyTotal value={s.value} /></p>
            <p className="text-xs text-muted-foreground">Value</p>
          </div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button variant="outline" size="sm" className="flex-1" render={<Link href={`/locations/${l.id}`} />} nativeButton={false}>
            View stock
          </Button>
          {canEdit && (
            <Button variant="ghost" size="icon-sm" onClick={() => setEditing(l)} aria-label="Edit">
              <Pencil />
            </Button>
          )}
          {scope.isOwner && (
            <>
              <ConfirmAction
                trigger={
                  <Button variant="ghost" size="icon-sm" aria-label="Delete">
                    <Trash2 />
                  </Button>
                }
                title={`Delete ${l.name}?`}
                description="You can only delete a location after its stock has been moved or removed."
                confirmLabel="Delete"
                destructive
                onConfirm={() => attempt(() => actions.deleteLocation(l.id), "Location deleted")}
              />
            </>
          )}
        </CardFooter>
      </Card>
    )
  }

  return (
    <PageBody>
      <PageHeader
        title="Warehouses & shops"
        description="Every place you keep stock. Open one to see exactly what's there."
        actions={
          scope.isOwner && (
            <Button onClick={() => setEditing("new")}>
              <Plus />
              Add location
            </Button>
          )
        }
      />

      {scope.locations.length === 0 && <EmptyState icon={Warehouse} title="No locations" description="No warehouses or shops are assigned to you yet." />}

      {warehouses.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Warehouses</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{warehouses.map(renderCard)}</div>
        </section>
      )}
      {outlets.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Shops & outlets</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{outlets.map(renderCard)}</div>
        </section>
      )}

      {editing && <LocationDialog location={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </PageBody>
  )
}

function LocationDialog({ location, onClose }: { location?: Location; onClose: () => void }) {
  const { addLocation, updateLocation } = actions
  const [name, setName] = useState(location?.name ?? "")
  const [type, setType] = useState<LocationType>(location?.type ?? "outlet")
  const [address, setAddress] = useState(location?.address ?? "")
  const [phone, setPhone] = useState(location?.phone ?? "")

  const [run, pending] = useAttempt()
  const required = useRequired()
  const nameOk = name.trim().length >= 2
  const addressOk = !!address.trim()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!required.check(nameOk && addressOk, e)) return
    const data = { name: name.trim(), type, address: address.trim(), phone: phone.trim() || undefined }
    const ok = await run(
      () => (location ? updateLocation(location.id, data) : addLocation(data)),
      location ? "Location updated" : "Location added",
    )
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{location ? "Edit location" : "Add location"}</DialogTitle>
            <DialogDescription>A warehouse stores bulk stock; a shop or outlet sells to customers.</DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="loc-name" required missing={required.shown && !nameOk}>
            <Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverside Shop" autoFocus />
          </Field>
          <Field label="Type" required>
            <SimpleSelect
              value={type}
              onChange={(v) => setType(v as LocationType)}
              options={[
                { value: "warehouse", label: "Warehouse" },
                { value: "outlet", label: "Shop / outlet" },
              ]}
            />
          </Field>
          <Field label="Address" htmlFor="loc-address" required missing={required.shown && !addressOk}>
            <Input id="loc-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="loc-phone">
            <Input id="loc-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {location ? "Save" : "Add location"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
