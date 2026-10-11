import type { Metadata } from "next"
import { getBusinesses } from "@/lib/auth/platform-actions"
import { BusinessesView } from "./view"

export const metadata: Metadata = { title: "Businesses" }

export default async function BusinessesPage({ searchParams }: PageProps<"/platform/businesses">) {
  const businesses = await getBusinesses()
  const { new: openNew } = await searchParams
  return <BusinessesView businesses={businesses} openNew={openNew === "1"} />
}
