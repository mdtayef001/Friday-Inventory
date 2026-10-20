import { Suspense } from "react"
import type { Metadata } from "next"
import { PageSkeleton } from "@/components/store-gate"
import { getBusinesses } from "@/lib/auth/platform-actions"
import { BusinessesView } from "./view"

export const metadata: Metadata = { title: "Businesses" }

export default function BusinessesPage({ searchParams }: PageProps<"/platform/businesses">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Businesses searchParams={searchParams} />
    </Suspense>
  )
}

async function Businesses({ searchParams }: Pick<PageProps<"/platform/businesses">, "searchParams">) {
  const businesses = await getBusinesses()
  const { new: openNew } = await searchParams
  return <BusinessesView businesses={businesses} openNew={openNew === "1"} />
}
