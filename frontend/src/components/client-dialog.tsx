"use client"

import { useState } from "react"
import { UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useStore } from "@/lib/store"
import type { Client } from "@/lib/types"
import { useAttempt, Field, SimpleSelect } from "./common"

export function ClientDialog({ client, onClose, onSaved }: { client?: Client; onClose: () => void; onSaved?: (client: Client) => void }) {
  const addClient = useStore((s) => s.addClient)
  const updateClient = useStore((s) => s.updateClient)
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

/** Client dropdown with a button to add a new client on the spot. */
export function ClientPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const clients = useStore((s) => s.clients)
  const [adding, setAdding] = useState(false)
  return (
    <div className="flex gap-2">
      <SimpleSelect
        value={value}
        onChange={onChange}
        options={clients.map((c) => ({ value: c.id, label: c.company ? `${c.name} · ${c.company}` : c.name }))}
        placeholder="Choose client"
      />
      <Button type="button" variant="outline" onClick={() => setAdding(true)}>
        <UserPlus />
        New
      </Button>
      {adding && <ClientDialog onClose={() => setAdding(false)} onSaved={(c) => onChange(c.id)} />}
    </div>
  )
}
