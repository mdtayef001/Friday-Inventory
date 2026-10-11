import type { Metadata } from "next"
import { requireAccess } from "@/lib/auth/dal"
import { LocationDetailView } from "./view"

export const metadata: Metadata = { title: "Location" }

export default async function LocationPage({ params }: PageProps<"/locations/[id]">) {
  await requireAccess("/locations/[id]")
  const { id } = await params
  return <LocationDetailView id={id} />
}
