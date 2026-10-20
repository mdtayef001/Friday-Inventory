import { CheckCircle2, RotateCcw, Store } from "lucide-react"
import { ReceiptPaper } from "@/components/receipt-paper"
import { formatDateTime, formatMoneyIn } from "@/lib/format"
import type { Receipt } from "@/lib/types"

const REFERENCE_LABEL = { store: "", order: "Order", rental: "Rental" } as const

/**
 * The buyer's receipt for one paid checkout, with every item on it. Rendered on the server for both the
 * team's printable copy (/receipt/[id]) and the buyer's link (/r/[token]), so
 * it formats money in the business's own currency rather than through <StoreGate>.
 */
export function ReceiptDocument({ receipt: r }: { receipt: Receipt }) {
  const money = (value: number) => formatMoneyIn(value, r.currency)
  const rows: [string, string][] = [
    ["Date", formatDateTime(r.soldAt)],
    ...(r.reference ? ([[REFERENCE_LABEL[r.channel] || "Reference", r.reference]] as [string, string][]) : []),
    ["Customer", r.client ? `${r.client.name}${r.client.company ? ` (${r.client.company})` : ""}` : "Walk-in customer"],
    ...(r.soldBy ? ([["Served by", r.soldBy]] as [string, string][]) : []),
    ["Payment", r.paymentLabel || "Not recorded"],
    ...(r.paymentReference ? ([["Transaction ID", r.paymentReference]] as [string, string][]) : []),
  ]

  return (
    <>
      <article className="rounded-xl border bg-background p-6 shadow-sm sm:p-8 print:hidden">
        <header className="space-y-1 border-b pb-5 text-center">
          <span className="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground print:border">
            <Store className="size-5" />
          </span>
          <p className="text-lg font-semibold [overflow-wrap:anywhere]">{r.businessName}</p>
          {r.shop && (
            <>
              <p className="text-sm text-muted-foreground">{r.shop.name}</p>
              {r.shop.address && <p className="text-sm text-muted-foreground">{r.shop.address}</p>}
              {r.shop.phone && <p className="text-sm text-muted-foreground">{r.shop.phone}</p>}
            </>
          )}
        </header>

        <section className="flex items-center justify-between gap-3 border-b py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Receipt</h1>
            <p className="font-mono text-sm text-muted-foreground">{r.receiptNo}</p>
          </div>
          {r.refundedAt ? (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-red-600/10 px-2.5 py-0.5 text-sm font-medium text-red-700 dark:text-red-400">
              <RotateCcw className="size-4" />
              Refunded
            </p>
          ) : (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-green-600/10 px-2.5 py-0.5 text-sm font-medium text-green-700 dark:text-green-400">
              <CheckCircle2 className="size-4" />
              Paid
            </p>
          )}
        </section>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b py-4 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>

        {/* Fixed layout so long names and big amounts wrap inside the receipt instead of pushing it wider.
            On phones, quantity and price move under the item name. */}
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">Item</th>
              <th className="hidden w-12 py-2 text-right font-medium sm:table-cell">Qty</th>
              <th className="hidden w-24 py-2 text-right font-medium sm:table-cell">Price</th>
              <th className="w-28 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((item, i) => (
              <tr key={i} className="border-b align-top">
                <td className="py-3 pr-2 font-medium [overflow-wrap:anywhere]">
                  {item.name}
                  <span className="block text-xs font-normal text-muted-foreground tabular-nums sm:hidden">
                    {item.quantity} × {money(item.unitPrice)}
                  </span>
                  {item.returned && <span className="block text-xs font-normal text-red-700 dark:text-red-400">Returned</span>}
                </td>
                <td className="hidden py-3 text-right tabular-nums sm:table-cell">{item.quantity}</td>
                <td className="hidden py-3 pl-2 text-right tabular-nums [overflow-wrap:anywhere] sm:table-cell">{money(item.unitPrice)}</td>
                <td className="py-3 pl-2 text-right tabular-nums [overflow-wrap:anywhere]">{money(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto mt-4 w-full max-w-64 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{money(r.subtotal)}</span>
          </div>
          {r.discount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span className="tabular-nums">−{money(r.discount)}</span>
            </div>
          )}
          <div className="flex justify-between gap-3 border-t pt-2 text-base font-semibold">
            <span>{r.refundedAt ? "Total (refunded)" : "Total paid"}</span>
            <span className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{money(r.total)}</span>
          </div>
          {r.refunded > 0 && !r.refundedAt && (
            <>
              <div className="flex justify-between text-red-700 dark:text-red-400">
                <span>Refunded for returns</span>
                <span className="tabular-nums">−{money(r.refunded)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Kept</span>
                <span className="tabular-nums">{money(r.total - r.refunded)}</span>
              </div>
            </>
          )}
        </div>

        <footer className="mt-8 space-y-1 border-t pt-4 text-center text-xs text-muted-foreground">
          {r.note && <p className="whitespace-pre-line text-foreground [overflow-wrap:anywhere]">{r.note}</p>}
          <p>{r.refundedAt ? `Refunded on ${formatDateTime(r.refundedAt)}. ` : ""}Thank you for shopping with {r.businessName}.</p>
        </footer>
      </article>
      <ReceiptPaper>
        <TillReceipt receipt={r} rows={rows} money={money} />
      </ReceiptPaper>
    </>
  )
}

/**
 * The printed copy, laid out like a shop till slip: narrow, solid black on
 * white (thermal printers turn grey into speckles), item details on their own
 * line so long names and prices still fit.
 */
function TillReceipt({ receipt: r, rows, money }: { receipt: Receipt; rows: [string, string][]; money: (value: number) => string }) {
  const rule = "my-[2mm] border-t border-dashed border-black"
  return (
    <div>
      <div className="text-center">
        <p className="text-[16px] leading-tight font-bold">{r.businessName}</p>
        {r.shop && (
          <>
            <p>{r.shop.name}</p>
            {r.shop.address && <p>{r.shop.address}</p>}
            {r.shop.phone && <p>{r.shop.phone}</p>}
          </>
        )}
      </div>
      <div className={rule} />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-bold">{r.refundedAt ? "RECEIPT · REFUNDED" : "RECEIPT"}</span>
        <span className="font-mono">{r.receiptNo}</span>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <span className="shrink-0">{k}</span>
          <span className="text-right break-words">{v}</span>
        </div>
      ))}
      <div className={rule} />
      {r.items.map((item, i) => (
        <div key={i} className="mb-[1mm]">
          <p className="font-bold break-words">
            {item.name}
            {item.returned && " (RETURNED)"}
          </p>
          <div className="flex justify-between gap-2 tabular-nums">
            <span>
              {item.quantity} × {money(item.unitPrice)}
            </span>
            <span className="whitespace-nowrap">{money(item.amount)}</span>
          </div>
        </div>
      ))}
      <div className={rule} />
      <div className="flex justify-between tabular-nums">
        <span>Subtotal</span>
        <span>{money(r.subtotal)}</span>
      </div>
      {r.discount > 0 && (
        <div className="flex justify-between tabular-nums">
          <span>Discount</span>
          <span>−{money(r.discount)}</span>
        </div>
      )}
      <div className="mt-[1mm] flex justify-between text-[15px] font-bold tabular-nums">
        <span>{r.refundedAt ? "REFUNDED" : "TOTAL PAID"}</span>
        <span>{money(r.total)}</span>
      </div>
      {r.refunded > 0 && !r.refundedAt && (
        <>
          <div className="flex justify-between tabular-nums">
            <span>Refunded for returns</span>
            <span>−{money(r.refunded)}</span>
          </div>
          <div className="flex justify-between font-bold tabular-nums">
            <span>KEPT</span>
            <span>{money(r.total - r.refunded)}</span>
          </div>
        </>
      )}
      <div className={rule} />
      {r.note && <p className="text-center whitespace-pre-line [overflow-wrap:anywhere]">{r.note}</p>}
      <p className="text-center">
        {r.refundedAt ? `Refunded on ${formatDateTime(r.refundedAt)}. ` : ""}Thank you for shopping with {r.businessName}.
      </p>
    </div>
  )
}
