"use client"

import { useActionState, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, TriangleAlert } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { resetPassword, type ResetState } from "@/lib/auth/actions"

export function ResetPasswordForm({ uid, token }: { uid: string; token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPassword, {})
  const [show, setShow] = useState(false)

  if (state.done) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Password changed</h1>
        <p className="text-sm text-muted-foreground">Log in with your new password. You&apos;ve been logged out everywhere else.</p>
        <Button className="w-full" render={<Link href="/login" />} nativeButton={false}>
          Log in
        </Button>
      </div>
    )
  }

  if (!uid || !token) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">This link isn&apos;t complete</h1>
        <p className="text-sm text-muted-foreground">Open the link from the email again, or ask for a new one.</p>
        <Button className="w-full" render={<Link href="/forgot-password" />} nativeButton={false}>
          Send a new link
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">At least 8 characters, and not one that&apos;s easy to guess.</p>
      </div>
      <form action={action} className="space-y-4">
        {state.error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>
              {state.error}
              {/expired|already used/.test(state.error) && (
                <>
                  {" "}
                  <Link href="/forgot-password" className="font-medium underline underline-offset-2">
                    Send a new link
                  </Link>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}
        <input type="hidden" name="uid" value={uid} />
        <input type="hidden" name="token" value={token} />
        <div className="grid gap-1.5">
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Input id="password" name="password" type={show ? "text" : "password"} autoComplete="new-password" minLength={8} required autoFocus className="h-10 pr-10" />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm">Type it again</Label>
          <Input id="confirm" name="confirm" type={show ? "text" : "password"} autoComplete="new-password" required className="h-10" />
        </div>
        <Button type="submit" className="h-10 w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Save new password
        </Button>
      </form>
    </div>
  )
}
