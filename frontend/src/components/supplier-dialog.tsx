"use client"

import { useState } from "react"
import { ChevronsUpDown, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { actions } from "@/lib/data/actions"
import { useDebounced, useSuppliers } from "@/lib/data/queries"
import type { Supplier, SupplierBrief } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAttempt, useRequired, Field } from "./common"

const { addSupplier, updateSupplier } = actions

export function SupplierDialog({ supplier, onClose, onSaved }: { supplier?: Supplier; onClose: () => void; onSaved?: (supplier: Supplier) => void }) {
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    company: supplier?.company ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    address: supplier?.address ?? "",
  })
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const emailOk = !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)

  const [run, pending] = useAttempt()
  const required = useRequired()
  const nameOk = form.name.trim().length >= 2

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // Opened from inside another form (selling, an order, a purchase): don't let this submit reach it.
    e.stopPropagation()
    if (!required.check(nameOk, e)) return
    const data = {
      name: form.name.trim(),
      company: form.company.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      address: form.address.trim() || undefined,
    }
    let saved: Supplier | undefined
    const ok = await run(async () => {
      if (supplier) {
        await updateSupplier(supplier.id, data)
        saved = { ...supplier, ...data }
      } else {
        saved = await addSupplier(data)
      }
    }, supplier ? "Supplier updated" : "Supplier added")
    if (ok && saved) {
      onSaved?.(saved)
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{supplier ? "Edit supplier" : "New supplier"}</DialogTitle>
            <DialogDescription>Only the name is required.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="sp-name" required missing={required.shown && !nameOk}>
              <Input id="sp-name" value={form.name} onChange={set("name")} autoFocus />
            </Field>
            <Field label="Company" htmlFor="sp-company">
              <Input id="sp-company" value={form.company} onChange={set("company")} />
            </Field>
            <Field label="Phone" htmlFor="sp-phone">
              <Input id="sp-phone" type="tel" value={form.phone} onChange={set("phone")} />
            </Field>
            <Field label="Email" htmlFor="sp-email">
              <Input id="sp-email" type="email" value={form.email} onChange={set("email")} aria-invalid={!emailOk} />
            </Field>
            <Field label="Address" htmlFor="sp-address" className="sm:col-span-2">
              <Input id="sp-address" value={form.address} onChange={set("address")} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!emailOk || pending}>
              {supplier ? "Save" : "Add supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Pick a supplier by typing their name, company, phone or email, or add a new one on the spot.
 * With `allowNone`, "No supplier" is a choice too (stock bought at a market, say).
 * Filters pass `canAdd={false}`.
 */
export function SupplierPicker({
  value,
  onChange,
  allowNone,
  noneLabel = "No supplier",
  canAdd = true,
}: {
  value: SupplierBrief | null
  onChange: (supplier: SupplierBrief | null) => void
  allowNone?: boolean
  noneLabel?: string
  canAdd?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState("")
  const term = useDebounced(search.trim())
  const { data, isFetching, error } = useSuppliers({ page: 1, search: term }, { pageSize: 20, enabled: open })

  return (
    <div className="flex min-w-0 gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button type="button" variant="outline" role="combobox" aria-expanded={open} className="min-w-0 flex-1 justify-between font-normal" />}
        >
          <span className={cn("truncate", !value && !allowNone && "text-muted-foreground")}>
            {value ? (value.company ? `${value.name} · ${value.company}` : value.name) : allowNone ? noneLabel : "Choose supplier"}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={search} onValueChange={setSearch} placeholder="Search name, company, phone…" />
            <CommandList>
              {error ? (
                <p className="px-2 py-6 text-center text-sm text-destructive">{error.message}</p>
              ) : (
                <CommandEmpty>{isFetching || !data ? "Searching…" : "No suppliers found."}</CommandEmpty>
              )}
              {allowNone && !term && (
                <CommandItem
                  value="none"
                  onSelect={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                >
                  {noneLabel}
                </CommandItem>
              )}
              {data?.results.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.id}
                  onSelect={() => {
                    onChange(s)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{s.company || s.phone}</span>
                </CommandItem>
              ))}
              {data && data.count > data.results.length && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  Showing {data.results.length} of {data.count}. Type to narrow it down.
                </p>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {canAdd && (
        <Button type="button" variant="outline" onClick={() => setAdding(true)}>
          <Plus />
          New
        </Button>
      )}
      {adding && <SupplierDialog onClose={() => setAdding(false)} onSaved={onChange} />}
    </div>
  )
}
