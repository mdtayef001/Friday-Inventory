import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { CheckCircle2, Store } from "lucide-react"
import { getContext } from "@/lib/auth/dal"
import { PLATFORM, formatTaka } from "@/lib/business"
import { findPayment } from "@/lib/billing/queries"
import { formatDate, formatDateTime } from "@/lib/format"
import { PrintButton } from "@/components/print-button"

export const metadata: Metadata = { title: "Invoice" }

export default function InvoicePage({ params }: PageProps<"/invoice/[id]">) {
  return (
    <main className="min-h-svh bg-muted/40 px-4 py-8 print:bg-white print:p-0">
      <Suspense>
        <Invoice params={params} />
      </Suspense>
    </main>
  )
}

async function Invoice({ params }: Pick<PageProps<"/invoice/[id]">, "params">) {
  const ctx = await getContext()
  if (!ctx) redirect("/logout")
  const { id } = await params
  // Django only returns it to the business's owner and the super admin.
  const payment = await findPayment(id)
  if (!payment || payment.status !== "paid") notFound()

  const rows: [string, string][] = [
    ["Invoice no.", payment.invoiceNo!],
    ["Date paid", formatDateTime(payment.paidAt!)],
    ["Payment method", payment.method || "SSLCommerz"],
    ["Transaction ID", payment.reference || payment.tranId],
    ...(payment.bankTranId ? ([["Bank reference", payment.bankTranId]] as [string, string][]) : []),
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex justify-end print:hidden">
        <PrintButton />
      </div>
      <article className="rounded-xl border bg-background p-6 shadow-sm sm:p-10 print:rounded-none print:border-0 print:shadow-none">
        <header className="flex flex-col gap-6 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground print:border">
              <Store className="size-5" />
            </span>
            <div>
              <p className="font-semibold">{PLATFORM.name}</p>
              <p className="text-sm text-muted-foreground">{PLATFORM.address}</p>
              <p className="text-sm text-muted-foreground">{PLATFORM.email}</p>
            </div>
          </div>
          <div className="sm:text-right">
            <h1 className="text-2xl font-semibold tracking-tight">Invoice</h1>
            <p className="font-mono text-sm text-muted-foreground">{payment.invoiceNo}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-green-600/10 px-2.5 py-0.5 text-sm font-medium text-green-700 dark:text-green-400">
              <CheckCircle2 className="size-4" />
              Paid
            </p>
          </div>
        </header>

        <section className="grid gap-6 border-b py-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Billed to</p>
            <p className="mt-1 font-medium">{payment.businessName}</p>
            <p className="text-sm">{payment.payer.name}</p>
            <p className="text-sm text-muted-foreground">{payment.payer.email}</p>
            {payment.payer.phone && <p className="text-sm text-muted-foreground">{payment.payer.phone}</p>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:justify-self-end">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium break-all sm:text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="overflow-x-auto">
          <table className="w-full py-6 text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-3 font-medium">Description</th>
                <th className="py-3 font-medium">Period</th>
                <th className="py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="py-4">
                  <p className="font-medium">{PLATFORM.name} subscription</p>
                  <p className="text-muted-foreground">
                    {payment.months > 1 ? `${payment.months} months of the monthly plan` : "Monthly plan"}, everything included
                  </p>
                </td>
                <td className="py-4 whitespace-nowrap">
                  {formatDate(payment.periodStart!)} – {formatDate(payment.periodEnd!)}
                </td>
                <td className="py-4 text-right tabular-nums">{formatTaka(payment.amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="ml-auto mt-4 w-full max-w-64 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatTaka(payment.amount)}</span>
          </div>
          <div className="flex justify-between border-t pt-2 text-base font-semibold">
            <span>Total paid</span>
            <span className="tabular-nums">
              {formatTaka(payment.amount)} {payment.currency}
            </span>
          </div>
        </div>

        <footer className="mt-10 border-t pt-4 text-xs text-muted-foreground">
          {payment.channel === "manual" ? (payment.amount > 0 ? "Paid directly and confirmed by Friday." : "Given free of charge.") : "Paid online through SSLCommerz."} This invoice
          was generated automatically and is valid without a signature.
        </footer>
      </article>
    </div>
  )
}
