import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PrintButton } from "@/components/print-button"
import { ReceiptDocument } from "@/components/receipt"
import { ReceiptShare } from "@/components/receipt-share"
import { Skeleton } from "@/components/ui/skeleton"
import { requireRole } from "@/lib/auth/dal"
import { apiOrNull } from "@/lib/api/server"
import type { Receipt } from "@/lib/types"

export const metadata: Metadata = { title: "Receipt" }

// The team's copy of a sale's receipt: print it, or send the buyer their link.
export default function ReceiptPage({ params }: PageProps<"/receipt/[id]">) {
  return (
    <main className="min-h-svh bg-muted/40 px-4 py-8 print:bg-white print:p-0">
      <Suspense fallback={<Skeleton className="mx-auto h-[32rem] w-full max-w-md rounded-xl" />}>
        <TeamReceipt params={params} />
      </Suspense>
    </main>
  )
}

async function TeamReceipt({ params }: Pick<PageProps<"/receipt/[id]">, "params">) {
  // A locked business goes to /subscribe instead of hitting Django's "locked" error.
  await requireRole(["owner", "manager", "staff"])
  const { id } = await params
  // Django only returns sales this user can see (staff: their own), once paid.
  const receipt = /^\d+$/.test(id) ? await apiOrNull<Receipt>(`sales/${id}/receipt/`) : null
  if (!receipt) notFound()

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex justify-end print:hidden">
        <PrintButton />
      </div>
      <ReceiptDocument receipt={receipt} />
      {receipt.receiptToken && (
        <div className="bg-background print:hidden">
          <ReceiptShare token={receipt.receiptToken} receiptNo={receipt.receiptNo} businessName={receipt.businessName} client={receipt.client} />
        </div>
      )}
    </div>
  )
}
