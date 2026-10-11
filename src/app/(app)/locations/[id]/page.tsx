import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/dal"
import { LocationDetailView } from "./view"

export const metadata: Metadata = { title: "Location" }

export default async function LocationPage({ params }: PageProps<"/locations/[id]">) {
  await requireRole(["admin", "manager"])
  const { id } = await params
  return <LocationDetailView id={id} />
}
