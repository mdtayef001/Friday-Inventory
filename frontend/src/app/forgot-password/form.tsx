"use client"

import { useActionState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, MailCheck, Send, TriangleAlert } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requestPasswordReset, type ResetState } from "@/lib/auth/actions"
import { PLATFORM } from "@/lib/business"

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ResetState, FormData>(requestPasswordReset, {})

  if (state.done) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          If that email belongs to a business owner, we&apos;ve sent it a link to set a new password. It works for 3 days. Look in spam if
          you don&apos;t see it.
        </p>
        <p className="text-sm text-muted-foreground">Managers and staff: no email is sent. Ask your business owner to reset it for you.</p>
        <NeedHelp />
        <BackToLogin />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
        <p className="text-sm text-muted-foreground">
          Business owners: type the email you log in with, and we&apos;ll send you a link to choose a new one.
        </p>
      </div>
      <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        Managers and staff: ask your business owner. They can set a new password for you on Users &amp; Staff.
      </p>
      <form action={action} className="space-y-4">
        {state.error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" placeholder="you@company.com" required autoFocus className="h-10" />
        </div>
        <Button type="submit" className="h-10 w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          Send the link
        </Button>
      </form>
      <NeedHelp />
      <BackToLogin />
    </div>
  )
}

/** For an owner whose email didn't arrive, or who no longer has that email. */
function NeedHelp() {
  return (
    <p className="rounded-lg bg-muted/60 px-3 py-2 text-center text-sm text-muted-foreground">
      Business owners still locked out? Message us on WhatsApp: <span className="font-medium text-foreground">{PLATFORM.whatsapp}</span>
    </p>
  )
}

function BackToLogin() {
  return (
    <Button variant="ghost" className="w-full" render={<Link href="/login" />} nativeButton={false}>
      <ArrowLeft />
      Back to log in
    </Button>
  )
}
