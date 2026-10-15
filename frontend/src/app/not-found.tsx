import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, SearchX, Store } from "lucide-react"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Page not found" }

// "/" goes to the logged-in user's home page, or to the login page.
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="mb-8 flex items-center gap-2 text-sm font-medium">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Store className="size-4" />
        </span>
        Friday Inventory
      </div>
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <SearchX className="size-6" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-muted-foreground">
          This page doesn&apos;t exist or has been moved. Check the address, or go back to where you started.
        </p>
        <Button className="mt-6" render={<Link href="/" />} nativeButton={false}>
          <ArrowLeft />
          Go home
        </Button>
      </div>
    </main>
  )
}
