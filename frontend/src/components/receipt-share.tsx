"use client"

import { useSyncExternalStore } from "react"
import { Copy, Mail, MessageCircle, ReceiptText } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { whatsappNumber } from "@/components/tracking-link"

const noSubscribe = () => () => {}

/** The buyer's public receipt page. The origin is only known in the browser, so the server renders the path. */
function useReceiptUrl(token: string) {
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "")
  return `${origin}/r/${token}`
}

/** Copy / WhatsApp / email the buyer a link to their receipt. */
export function ReceiptShare({
  token,
  receiptNo,
  businessName,
  client,
}: {
  token: string
  receiptNo: string
  businessName: string
  client?: { name: string; phone?: string; email?: string } | null
}) {
  const url = useReceiptUrl(token)
  const greeting = client ? `Hi ${client.name.split(" ")[0]}, ` : "Hi, "
  const message = `${greeting}here is your receipt ${receiptNo} from ${businessName}: ${url}`
  const wa = whatsappNumber(client?.phone)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Receipt link copied. Paste it to the customer.")
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.")
    }
  }

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <ReceiptText className="size-4" />
          Send the receipt
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">The customer opens it on their phone. No login needed.</p>
      </div>
      <p className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs break-all select-all">
        {url}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          <Copy />
          Copy link
        </Button>
        <Button
          size="sm"
          variant="outline"
          render={<a href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
        >
          <MessageCircle />
          WhatsApp
        </Button>
        {client?.email && (
          <Button
            size="sm"
            variant="outline"
            render={<a href={`mailto:${client.email}?subject=${encodeURIComponent(`Your receipt ${receiptNo} from ${businessName}`)}&body=${encodeURIComponent(message)}`} />}
            nativeButton={false}
          >
            <Mail />
            Email
          </Button>
        )}
      </div>
    </div>
  )
}
