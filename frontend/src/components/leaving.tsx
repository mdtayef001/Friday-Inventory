"use client"

import { useState, useTransition } from "react"
import { CalendarX2, Loader2, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmAction, Field, useRequired } from "@/components/common"
import { DownloadDataButton } from "@/components/billing"
import type { ActionResult } from "@/lib/api/server"
import { cancelDeletion, requestDeletion, setSubscriptionCancelled } from "@/lib/auth/business-actions"
import { accessEndsAt } from "@/lib/business"
import { formatDate } from "@/lib/format"
import type { Business } from "@/lib/types"

function showResult(result: ActionResult, success: string) {
  if (result.ok) toast.success(success)
  else toast.error(result.error)
  return result.ok
}

/**
 * On Billing: payments are never taken automatically, so cancelling means "don't renew".
 * Access runs to the end of what's paid, the reminders stop, and paying again undoes it.
 */
export function CancelSubscriptionCard({ business }: { business: Business }) {
  const [pending, startTransition] = useTransition()
  const until = formatDate(accessEndsAt(business))
  if (business.status === "closing") return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarX2 className="size-4 text-primary" />
          {business.cancelledAt ? "Subscription cancelled" : "Cancel subscription"}
        </CardTitle>
        <CardDescription>
          {business.cancelledAt
            ? `You won't be reminded to pay. ${business.name} works until ${until}, then locks. Your data stays, and paying again starts it back up.`
            : `Nothing is ever taken from you automatically, so cancelling just means you won't renew. You keep using ${business.name} until ${until}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {business.cancelledAt ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => startTransition(async () => void showResult(await setSubscriptionCancelled(false), "Subscription resumed"))}
          >
            {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Keep my subscription
          </Button>
        ) : (
          <ConfirmAction
            trigger={<Button variant="outline">Cancel subscription</Button>}
            title="Cancel your subscription?"
            description={`You keep everything until ${until}. After that ${business.name} locks for your team until you pay again. Nothing is deleted.`}
            confirmLabel="Cancel subscription"
            destructive
            onConfirm={async () => showResult(await setSubscriptionCancelled(true), `Cancelled. You can keep using it until ${until}.`)}
          />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * On Settings and the locked page: the Owner asks for the business to be deleted, and can take it
 * back at any point until it's gone. The super admin approves it; it's deleted 30 days later.
 */
export function DeleteBusinessCard({ business, isMainOwner }: { business: Business; isMainOwner: boolean }) {
  const [asking, setAsking] = useState(false)
  const [pending, startTransition] = useTransition()
  const keep = () => startTransition(async () => void showResult(await cancelDeletion(), `${business.name} stays. Nothing will be deleted.`))

  const state = business.deleteOn
    ? `Approved. ${business.name} is locked and will be deleted for good on ${formatDate(business.deleteOn)}. Download your data before then. You can still change your mind.`
    : business.deletionRequestedAt
      ? `You asked on ${formatDate(business.deletionRequestedAt)}. Nothing changes until it's approved; then the business locks and is deleted 30 days later.`
      : `Deletes the business and everything in it: products, stock, sales, staff accounts and the rest. You ask, we approve it, and it's deleted 30 days later. Until then you can change your mind.`

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Trash2 className="size-4" />
          {business.deleteOn ? "Being deleted" : business.deletionRequestedAt ? "Deletion requested" : "Delete this business"}
        </CardTitle>
        <CardDescription>{state}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {business.deletionRequestedAt ? (
          <Button variant="outline" disabled={pending} onClick={keep}>
            {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            {business.deleteOn ? "Stop the deletion" : "Cancel my request"}
          </Button>
        ) : isMainOwner ? (
          <Button variant="outline" className="text-destructive" onClick={() => setAsking(true)}>
            <Trash2 />
            Ask to delete
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Only the Owner can ask for this.</p>
        )}
        {business.deleteOn && <DownloadDataButton />}
      </CardContent>
      {asking && <AskToDeleteDialog name={business.name} onClose={() => setAsking(false)} />}
    </Card>
  )
}

function AskToDeleteDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [typed, setTyped] = useState("")
  const [pending, startTransition] = useTransition()
  const required = useRequired()
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase()

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!required.check(matches, e)) return
            startTransition(async () => {
              if (showResult(await requestDeletion(typed), "Request sent. We'll let you know when it's approved.")) onClose()
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>
              Once approved, everything is deleted 30 days later and can&apos;t be brought back. Download your data first if you want to keep it.
            </DialogDescription>
          </DialogHeader>
          <DownloadDataButton className="justify-self-start" />
          <Field label={`Type ${name} to confirm`} htmlFor="delete-name" required missing={required.shown && !matches}>
            <Input id="delete-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Keep it
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Ask to delete
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
