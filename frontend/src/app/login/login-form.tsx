"use client"

import { useActionState, useRef, useState } from "react"
import Link from "next/link"
import { Eye, EyeOff, Loader2, LockKeyhole, TriangleAlert } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { login, type LoginState } from "@/lib/auth/actions"

const DEMO_ACCOUNTS = [
  { role: "Super admin", email: "super@friday.app", password: "super123", note: "Runs the platform: all businesses" },
  { role: "Owner", email: "owner@friday.app", password: "owner123", note: "Friday Demo Store: full access" },
  { role: "Manager", email: "manager@friday.app", password: "manager123", note: "Downtown & Uptown outlets" },
  { role: "Staff", email: "staff@friday.app", password: "staff123", note: "Main Warehouse: sells, adds stock, rents out" },
  { role: "Staff (sell only)", email: "seller@friday.app", password: "staff123", note: "Main Warehouse: sells, can't add products" },
  { role: "Staff (products only)", email: "stocker@friday.app", password: "staff123", note: "Main Warehouse: adds products, can't sell" },
  { role: "Owner (on trial)", email: "cafe@friday.app", password: "cafe1234", note: "Green Leaf Café: trial ends in 2 days" },
  { role: "Owner (unpaid)", email: "urban@friday.app", password: "urban123", note: "Urban Party Rentals: locked, must pay" },
]

export function LoginForm({ showDemoAccounts }: { showDemoAccounts: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {})
  const [showPassword, setShowPassword] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const fill = (email: string, password: string) => {
    if (emailRef.current) emailRef.current.value = email
    if (passwordRef.current) passwordRef.current.value = password
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Log in with the account your business owner gave you.</p>
      </div>

      <form action={action} className="space-y-4">
        {state.error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            ref={emailRef}
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            defaultValue={state.email}
            required
            autoFocus
            className="h-10"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              ref={passwordRef}
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              className="h-10 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" className="h-10 w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
          {pending ? "Logging in…" : "Log in"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          No account? Ask your business owner to create one for you.
        </p>
        <p className="text-center text-xs text-muted-foreground">
          By logging in you agree to the{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </form>

      {showDemoAccounts && (
        <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">Demo accounts (click to fill)</p>
          <div className="grid gap-1.5">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => fill(a.email, a.password)}
                className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <span>
                  <span className="font-medium">{a.role}</span>
                  <span className="block text-xs text-muted-foreground">{a.note}</span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">{a.email}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
