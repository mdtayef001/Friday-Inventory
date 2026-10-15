import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PrintButton } from "@/components/print-button"
import { ReceiptDocument } from "@/components/receipt"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api/server"
import { ApiError } from "@/lib/api/errors"
import type { Receipt } from "@/lib/types"

// The buyer's receipt link. No login: the long random token in the URL is the
// key, and Django leaves out anything internal.

export const metadata: Metadata = { title: "Your receipt", robots: { index: false, follow: false } }

export default function PublicReceiptPage({ params }: PageProps<"/r/[token]">) {
  return (
    <main className="min-h-svh bg-muted/40 px-4 py-8 print:bg-white print:p-0">
      <Suspense fallback={<Skeleton className="mx-auto h-[32rem] w-full max-w-md rounded-xl" />}>
        <BuyerReceipt params={params} />
      </Suspense>
    </main>
  )
}

async function BuyerReceipt({ params }: Pick<PageProps<"/r/[token]">, "params">) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) notFound()
  let receipt: Receipt
  try {
    receipt = await api<Receipt>(`receipts/${token}/`, { token: null })
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <ReceiptDocument receipt={receipt} />
      <div className="flex flex-col items-center gap-2 print:hidden">
        <PrintButton />
        <p className="text-center text-xs text-muted-foreground">Keep this link to see your receipt again.</p>
      </div>
    </div>
  )
}
