import Link from "next/link"
import { Store } from "lucide-react"

/** Pages outside the app (password reset, terms): the name on top, a narrow column, and the legal links. */
export function StandalonePage({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-svh flex-col items-center bg-muted/40 px-4 py-10">
      <Link href="/login" className="mb-8 flex items-center gap-2 text-sm font-medium">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Store className="size-4" />
        </span>
        Friday Inventory
      </Link>
      <div className={wide ? "w-full max-w-2xl" : "w-full max-w-sm"}>{children}</div>
      <LegalLinks className="mt-auto pt-10" />
    </main>
  )
}

export function LegalLinks({ className }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-muted-foreground ${className ?? ""}`}>
      <Link href="/terms" className="underline-offset-2 hover:underline">
        Terms of Service
      </Link>
      {" · "}
      <Link href="/privacy" className="underline-offset-2 hover:underline">
        Privacy Policy
      </Link>
    </p>
  )
}
