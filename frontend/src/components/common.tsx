"use client"

import { useState } from "react"
import { AlertTriangle, ChevronLeft, ChevronRight, RotateCcw, Search, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { formatMoney, formatMoneyShort, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6", className)}>{children}</div>
}

const TONES = {
  default: "bg-primary/10 text-primary",
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
}
export type Tone = keyof typeof TONES

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon: LucideIcon
  tone?: Tone
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  )
}

const PILL_TONES = {
  gray: "bg-muted text-muted-foreground",
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  red: "bg-red-500/10 text-red-700 dark:text-red-300",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
}
export type PillTone = keyof typeof PILL_TONES

export function Pill({ tone = "gray", children, className }: { tone?: PillTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export interface Option {
  value: string
  label: string
}

export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  id,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  className?: string
  id?: string
  disabled?: boolean
}) {
  return (
    <Select
      items={options}
      value={value || null}
      onValueChange={(v) => onChange((v as string | null) ?? "")}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Runs a store action, toasting success or the readable error. Resolves to whether it worked. */
export async function attempt(fn: () => unknown, success?: string) {
  try {
    await fn()
    if (success) toast.success(success)
    return true
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Something went wrong.")
    return false
  }
}

export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  onConfirm,
  defaultOpen = false,
  onOpenChange,
}: {
  /** Leave out to control opening yourself (e.g. from a menu item) with defaultOpen. */
  trigger?: React.ReactElement
  title: string
  description: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => boolean | void | Promise<boolean | void>
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpenState] = useState(defaultOpen)
  const [busy, setBusy] = useState(false)
  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger && <AlertDialogTrigger render={trigger} />}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const result = await onConfirm()
              setBusy(false)
              if (result !== false) setOpen(false)
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * attempt() for forms: ignores repeat clicks while a save is still running,
 * so a double click can't create two orders. Disable the submit button with `pending`.
 */
export function useAttempt() {
  const [pending, setPending] = useState(false)
  async function run(fn: () => unknown, success?: string) {
    if (pending) return false
    setPending(true)
    try {
      return await attempt(fn, success)
    } finally {
      setPending(false)
    }
  }
  return [run, pending] as const
}

/** "1–50 of 230" with previous and next buttons. Hidden when everything fits on one page. */
export function Pager({
  page,
  pageSize,
  count,
  onPage,
  busy,
}: {
  page: number
  pageSize: number
  count: number
  onPage: (page: number) => void
  /** The next page is loading. */
  busy?: boolean
}) {
  if (count <= pageSize) return null
  const pages = Math.ceil(count / pageSize)
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, count)
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span className="tabular-nums">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(count)}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages || busy} onClick={() => onPage(page + 1)}>
          Next
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

/** A list that couldn't load, with a way to try again. */
export function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
      <AlertTriangle className="size-6 text-amber-500" />
      <p className="max-w-sm text-sm text-muted-foreground">{error instanceof Error ? error.message : "Couldn't load this."}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw />
        Try again
      </Button>
    </div>
  )
}

/** Placeholder rows while a list loads for the first time. */
export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 rounded-lg" />
      ))}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 pl-9" />
    </div>
  )
}

/**
 * A money total in short form ("৳12.5 lakh", "$1.25 million"). Tap or click it for the
 * exact amount (and again to go back); the exact amount also shows on hover.
 */
export function MoneyTotal({ value }: { value: number }) {
  const [full, setFull] = useState(false)
  const exact = formatMoney(value)
  const short = formatMoneyShort(value)
  // Nothing to expand when the short form is already the exact amount.
  if (short === exact) return <>{exact}</>
  return (
    <button
      type="button"
      title={full ? "Show short" : exact}
      aria-label={full ? `${exact}, show short` : `${short}, show exact amount`}
      onClick={(e) => {
        e.stopPropagation()
        setFull((f) => !f)
      }}
      className="cursor-pointer rounded-sm text-left tabular-nums [overflow-wrap:anywhere] underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-muted-foreground"
    >
      {full ? exact : short}
    </button>
  )
}
