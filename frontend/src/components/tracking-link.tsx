"use client"

import { Copy, Link2, Mail, MessageCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useBusiness, usePermissions } from "@/components/session-provider"
import type { ClientBrief, Shipment } from "@/lib/types"

/** The client's public tracking page for an order. */
export function trackingUrl(shipment: Pick<Shipment, "trackingToken">) {
  return `${window.location.origin}/track/${shipment.trackingToken}`
}

export async function copyTrackingLink(shipment: Pick<Shipment, "trackingToken">) {
  try {
    await navigator.clipboard.writeText(trackingUrl(shipment))
    toast.success("Tracking link copied. Paste it to the client.")
  } catch {
    toast.error("Couldn't copy. Select the link and copy it by hand.")
  }
}

/** "01712345678" -> "8801712345678", the form wa.me expects. */
export function whatsappNumber(phone?: string) {
  const digits = (phone ?? "").replace(/\D/g, "")
  if (/^01\d{9}$/.test(digits)) return `88${digits}`
  return digits.length >= 10 ? digits : ""
}

/** Copy / WhatsApp / email the client their order's tracking link. */
export function TrackingLinkShare({ shipment, client }: { shipment: Shipment; client?: ClientBrief }) {
  const business = useBusiness()
  const { module } = usePermissions()
  if (!module("trackingLinks") || !shipment.trackingToken) return null

  const url = trackingUrl(shipment)
  const greeting = client ? `Hi ${client.name.split(" ")[0]}, ` : "Hi, "
  const message = `${greeting}you can follow your order ${shipment.code} from ${business.name} here: ${url}`
  const wa = whatsappNumber(client?.phone)

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Link2 className="size-4" />
          Client tracking link
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">The client sees the order status, nothing else. No login needed.</p>
      </div>
      <p className="truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs select-all" title={url}>
        {url}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => copyTrackingLink(shipment)}>
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
            render={<a href={`mailto:${client.email}?subject=${encodeURIComponent(`Your order ${shipment.code}`)}&body=${encodeURIComponent(message)}`} />}
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
