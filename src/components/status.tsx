import type { RentalStatus, ShipmentStatus, TransferStatus } from "@/lib/types"
import { Pill, type PillTone } from "./common"

export const SHIPMENT_STATUS: Record<ShipmentStatus, { label: string; tone: PillTone }> = {
  pending: { label: "Pending", tone: "gray" },
  processing: { label: "Processing", tone: "violet" },
  in_delivery: { label: "In delivery", tone: "blue" },
  delivered: { label: "Delivered", tone: "green" },
  returned: { label: "Returned", tone: "amber" },
  cancelled: { label: "Cancelled", tone: "red" },
}

/** Normal forward path for a shipment, used for the progress bar and "next step" button. */
export const SHIPMENT_FLOW: ShipmentStatus[] = ["pending", "processing", "in_delivery", "delivered"]

export function ShipmentStatusPill({ status }: { status: ShipmentStatus }) {
  const s = SHIPMENT_STATUS[status]
  return <Pill tone={s.tone}>{s.label}</Pill>
}

export function RentalStatusPill({ status, overdue }: { status: RentalStatus; overdue?: boolean }) {
  if (status === "returned") return <Pill tone="green">Returned</Pill>
  if (overdue) return <Pill tone="red">Overdue</Pill>
  return <Pill tone="blue">Active</Pill>
}

const TRANSFER_STATUS: Record<TransferStatus, { label: string; tone: PillTone }> = {
  in_transit: { label: "In transit", tone: "blue" },
  received: { label: "Received", tone: "green" },
  cancelled: { label: "Cancelled", tone: "red" },
}

export function TransferStatusPill({ status }: { status: TransferStatus }) {
  const s = TRANSFER_STATUS[status]
  return <Pill tone={s.tone}>{s.label}</Pill>
}

export function StockPill({ quantity, threshold }: { quantity: number; threshold: number }) {
  if (quantity <= 0) return <Pill tone="red">Out of stock</Pill>
  if (quantity <= threshold) return <Pill tone="amber">Low stock</Pill>
  return <Pill tone="green">In stock</Pill>
}
