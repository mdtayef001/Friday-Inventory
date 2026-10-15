"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, Loader2, MoreHorizontal, SearchCheck, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { Field, Pill, useAttempt } from "@/components/common"
import { useScope, useSessionUser } from "@/components/session-provider"
import { request } from "@/lib/api/client"
import { PAYMENT_METHODS } from "@/lib/business"
import { actions } from "@/lib/data/actions"
import { apiQuery } from "@/lib/data/queries"
import { getQueryClient } from "@/lib/data/query-client"
import { formatDateTime, formatMoney } from "@/lib/format"
import type { PaymentCheck, Sale } from "@/lib/types"

// Returns of shop sales. Owners and admins return a sale straight away; managers
// ask, and an owner or admin approves (which returns it) or declines. Staff
// don't see any of this.

type Mode = "return" | "request" | "approve" | "decline"

const REFUND_STATUS: Record<Exclude<Sale["refundStatus"], "">, { label: string; tone: "amber" | "green" | "red" }> = {
  processing: { label: "SSLCommerz refunding", tone: "amber" },
  refunded: { label: "SSLCommerz refunded", tone: "green" },
  cancelled: { label: "SSLCommerz cancelled refund", tone: "red" },
}

const returnable = (s: Sale) => s.channel === "store" && s.paymentStatus === "paid" && !s.refundedAt

/** Under the product name: where the sale's return stands. */
export function ReturnStatus({ sale: s }: { sale: Sale }) {
  if (s.refundedAt)
    return (
      <span className="flex flex-wrap gap-1" title={s.refundReason ? `Reason: ${s.refundReason}` : undefined}>
        <Pill tone="red">Refunded</Pill>
        {s.refundStatus && <Pill tone={REFUND_STATUS[s.refundStatus].tone}>{REFUND_STATUS[s.refundStatus].label}</Pill>}
      </span>
    )
  if (s.returnRequest === "requested")
    return (
      <span title={`${s.returnRequestedBy}: ${s.refundReason}`}>
        <Pill tone="amber">Return requested</Pill>
      </span>
    )
  if (s.returnRequest === "declined")
    return (
      <span title={s.returnDeclineNote ? `Declined: ${s.returnDeclineNote}` : "Declined"}>
        <Pill tone="gray">Return declined</Pill>
      </span>
    )
  return null
}

/** The row menu on the Sales page. Nothing for staff, or when there's nothing to do. */
export function SaleActions({ sale: s }: { sale: Sale }) {
  const { role } = useSessionUser()
  const [mode, setMode] = useState<Mode | null>(null)
  const [checking, setChecking] = useState(false)
  const isOwner = role === "owner"
  const requested = s.returnRequest === "requested"
  const canReturn = returnable(s) && (isOwner || (role === "manager" && !requested))
  const canCheck = role !== "staff" && s.paymentMethod === "online" && s.paymentStatus === "paid"
  if (!canReturn && !canCheck) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Sale actions" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {canReturn && isOwner && requested && (
            <>
              <DropdownMenuItem onClick={() => setMode("approve")}>
                <Check />
                Approve return
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode("decline")}>
                <X />
                Decline return
              </DropdownMenuItem>
            </>
          )}
          {canReturn && isOwner && !requested && (
            <DropdownMenuItem onClick={() => setMode("return")}>
              <Undo2 />
              Return and refund…
            </DropdownMenuItem>
          )}
          {canReturn && !isOwner && (
            <DropdownMenuItem onClick={() => setMode("request")}>
              <Undo2 />
              {s.returnRequest === "declined" ? "Ask again to return…" : "Ask to return…"}
            </DropdownMenuItem>
          )}
          {canReturn && canCheck && <DropdownMenuSeparator />}
          {canCheck && (
            <DropdownMenuItem onClick={() => setChecking(true)}>
              <SearchCheck />
              Check with SSLCommerz
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {mode && <ReturnDialog sale={s} mode={mode} onClose={() => setMode(null)} />}
      {checking && <PaymentCheckDialog sale={s} onClose={() => setChecking(false)} />}
    </>
  )
}

/** Owners and admins: managers' return requests waiting for a decision. Hidden when there are none. */
export function ReturnRequests() {
  const { role } = useSessionUser()
  const { data } = useQuery({ ...apiQuery<Sale[]>("sales/", { returns: "requested" }), enabled: role === "owner" })
  const [deciding, setDeciding] = useState<{ sale: Sale; mode: "approve" | "decline" } | null>(null)
  if (role !== "owner" || !data?.length) return null
  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Undo2 className="size-4 text-amber-600" />
          Returns waiting for you
        </CardTitle>
        <CardDescription>Managers asked to take these sales back. Approving puts the stock back and refunds the customer.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {data.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                {s.quantity} × {s.productName} · {formatMoney(s.revenue)}
              </p>
              <p className="text-muted-foreground">
                {s.receiptNo} · {s.paymentMethod ? PAYMENT_METHODS[s.paymentMethod].short : "Payment not recorded"} · asked by {s.returnRequestedBy}
                {s.returnRequestedAt ? `, ${formatDateTime(s.returnRequestedAt)}` : ""}
              </p>
              <p className="mt-0.5">“{s.refundReason}”</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeciding({ sale: s, mode: "decline" })}>
                Decline
              </Button>
              <Button size="sm" onClick={() => setDeciding({ sale: s, mode: "approve" })}>
                Approve
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
      {deciding && <ReturnDialog sale={deciding.sale} mode={deciding.mode} onClose={() => setDeciding(null)} />}
    </Card>
  )
}

const TITLE: Record<Mode, string> = { return: "Return and refund", request: "Ask to return", approve: "Approve return", decline: "Decline return" }

function ReturnDialog({ sale: s, mode, onClose }: { sale: Sale; mode: Mode; onClose: () => void }) {
  const { locations } = useScope()
  const [run, pending] = useAttempt()
  const [text, setText] = useState(mode === "approve" ? s.refundReason : "")
  const shop = locations.find((l) => l.id === s.locationId)?.name
  const online = s.paymentMethod === "online"
  const money = formatMoney(s.revenue)
  const how = s.paymentMethod ? PAYMENT_METHODS[s.paymentMethod].label.toLowerCase() : "the way they paid"

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const done = {
      return: () => actions.returnSale(s.id, text),
      approve: () => actions.returnSale(s.id, text),
      request: () => actions.requestReturn(s.id, text),
      decline: () => actions.declineReturn(s.id, text),
    }[mode]
    const message = {
      return: online ? "Returned. SSLCommerz is refunding the customer." : "Returned. The stock is back.",
      approve: online ? "Approved. SSLCommerz is refunding the customer." : "Approved. The stock is back.",
      request: "Sent. The owner or an admin will approve it.",
      decline: "Declined.",
    }[mode]
    if (await run(done, message)) onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{TITLE[mode]}</DialogTitle>
            <DialogDescription>
              {s.quantity} × {s.productName} · {money}
              {s.receiptNo ? ` · ${s.receiptNo}` : ""}
            </DialogDescription>
          </DialogHeader>
          {mode === "decline" ? (
            <p className="text-sm">
              {s.returnRequestedBy} asked: “{s.refundReason}”. Nothing changes; they see that it was declined.
            </p>
          ) : (
            <ul className="list-disc space-y-1 rounded-lg border p-3 pl-7 text-sm">
              {mode === "request" && <li className="list-none -ml-4 text-muted-foreground">Once the owner or an admin approves:</li>}
              <li>
                {s.quantity} go back into stock{shop ? ` at ${shop}` : ""}.
              </li>
              {online ? (
                <li>
                  SSLCommerz sends {money} back to the customer&apos;s {s.gatewayMethod || "card or wallet"}. It usually takes a few working days.
                </li>
              ) : (
                <li>
                  Give the customer {money} back ({how}). The app records it; the money itself is handed back by you.
                </li>
              )}
              <li>The sale stops counting in your totals.</li>
            </ul>
          )}
          <Field
            label={mode === "decline" ? "Note for the manager" : "Reason"}
            htmlFor="return-text"
            hint={mode === "request" ? "Required." : "Optional."}
          >
            <Textarea
              id="return-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder={mode === "decline" ? "e.g. Item was used" : "e.g. Wrong size, faulty"}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={mode === "decline" ? "outline" : "default"} disabled={pending || (mode === "request" && !text.trim())}>
              {pending && <Loader2 className="animate-spin" />}
              {{ return: `Return and refund ${money}`, approve: `Approve and refund ${money}`, request: "Send request", decline: "Decline" }[mode]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const PAYMENT_STATUS: Record<string, string> = {
  VALID: "Paid, confirmed by SSLCommerz",
  VALIDATED: "Paid, confirmed by SSLCommerz",
  PROCESSING: "Not finished",
  PENDING: "Not finished",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  UNATTEMPTED: "Never paid",
  EXPIRED: "Expired",
}

/** Asks SSLCommerz, live, what it has for this sale, and where its refund is. */
function PaymentCheckDialog({ sale: s, onClose }: { sale: Sale; onClose: () => void }) {
  // Its own key, not "sales": refreshing the sales lists must not ask SSLCommerz again.
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["sslcommerz-check", s.id],
    queryFn: async ({ signal }) => {
      const result = await request<PaymentCheck>(`sales/${s.id}/check-payment/`, { signal })
      if (result.sale.refundStatus !== s.refundStatus) await getQueryClient().invalidateQueries({ queryKey: ["sales"] })
      return result
    },
    staleTime: 0,
    gcTime: 0,
  })
  const p = data?.payment
  const refund = data?.sale.refundStatus || s.refundStatus
  const rows: [string, string][] = p
    ? [
        ["Status", PAYMENT_STATUS[p.status] ?? p.status],
        ["Amount", `${p.amount} ${p.currency}`],
        ["You receive", p.storeAmount ? `${p.storeAmount} ${p.currency} (after SSLCommerz's fee)` : ""],
        ["Paid with", p.cardType],
        ["Card / wallet", p.cardNo],
        ["Issuer", p.cardIssuer],
        ["Bank transaction ID", p.bankTranId],
        ["Paid on", p.tranDate],
        ["Risk", p.riskTitle],
      ]
    : []

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>SSLCommerz record</DialogTitle>
          <DialogDescription>
            {s.receiptNo} · {s.quantity} × {s.productName} · {formatMoney(s.revenue)}
          </DialogDescription>
        </DialogHeader>
        {isFetching && !data ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Asking SSLCommerz…
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Couldn't check with SSLCommerz."}</p>
        ) : !p ? (
          <p className="text-sm">SSLCommerz has no record of this payment.</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {rows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium break-all">{v}</dd>
                </div>
              ))}
          </dl>
        )}
        {refund && (
          <div className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <span>Refund</span>
            <Pill tone={REFUND_STATUS[refund].tone}>{REFUND_STATUS[refund].label}</Pill>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching && <Loader2 className="animate-spin" />}
            Check again
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
