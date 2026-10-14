"use client"

import { useState } from "react"
import { ChevronsUpDown, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { actions } from "@/lib/data/actions"
import { useClients, useDebounced } from "@/lib/data/queries"
import type { Client, ClientBrief } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAttempt, Field } from "./common"

const { addClient, updateClient } = actions

export function ClientDialog({ client, onClose, onSaved }: { client?: Client; onClose: () => void; onSaved?: (client: Client) => void }) {
  const [form, setForm] = useState({
    name: client?.name ?? "",
    company: client?.company ?? "",
    phone: client?.phone ?? "",
    email: client?.email ?? "",
    address: client?.address ?? "",
  })
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const emailOk = !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)

  const [run, pending] = useAttempt()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const data = {
      name: form.name.trim(),
      company: form.company.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      address: form.address.trim() || undefined,
    }
    let saved: Client | undefined
    const ok = await run(async () => {
      if (client) {
        await updateClient(client.id, data)
        saved = { ...client, ...data }
      } else {
        saved = await addClient(data)
      }
    }, client ? "Client updated" : "Client added")
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
            <DialogTitle>{client ? "Edit client" : "New client"}</DialogTitle>
            <DialogDescription>Only the name is required.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="cl-name">
              <Input id="cl-name" value={form.name} onChange={set("name")} autoFocus />
            </Field>
            <Field label="Company" htmlFor="cl-company">
              <Input id="cl-company" value={form.company} onChange={set("company")} placeholder="Optional" />
            </Field>
            <Field label="Phone" htmlFor="cl-phone">
              <Input id="cl-phone" type="tel" value={form.phone} onChange={set("phone")} />
            </Field>
            <Field label="Email" htmlFor="cl-email">
              <Input id="cl-email" type="email" value={form.email} onChange={set("email")} aria-invalid={!emailOk} />
            </Field>
            <Field label="Address" htmlFor="cl-address" className="sm:col-span-2">
              <Input id="cl-address" value={form.address} onChange={set("address")} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.name.trim().length < 2 || !emailOk || pending}>
              {client ? "Save" : "Add client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Pick a client by typing their name, company, phone or email, or add a new one on the spot. */
export function ClientPicker({ value, onChange }: { value: ClientBrief | null; onChange: (client: ClientBrief) => void }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState("")
  const term = useDebounced(search.trim())
  const { data, isFetching, error } = useClients({ page: 1, search: term }, { pageSize: 20, enabled: open })

  return (
    <div className="flex min-w-0 gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button type="button" variant="outline" role="combobox" aria-expanded={open} className="min-w-0 flex-1 justify-between font-normal" />}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? (value.company ? `${value.name} · ${value.company}` : value.name) : "Choose client"}
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
                <CommandEmpty>{isFetching || !data ? "Searching…" : "No clients found."}</CommandEmpty>
              )}
              {data?.results.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange(c)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{c.company || c.phone}</span>
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
      <Button type="button" variant="outline" onClick={() => setAdding(true)}>
        <UserPlus />
        New
      </Button>
      {adding && <ClientDialog onClose={() => setAdding(false)} onSaved={onChange} />}
    </div>
  )
}
