import { Suspense } from "react"
import type { Metadata } from "next"
import { PageSkeleton } from "@/components/store-gate"
import { notFound } from "next/navigation"
import { getBusiness } from "@/lib/auth/platform-actions"
import { BusinessDetailView } from "./view"

export const metadata: Metadata = { title: "Business" }

export default function BusinessPage({ params }: PageProps<"/platform/businesses/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Business params={params} />
    </Suspense>
  )
}

async function Business({ params }: Pick<PageProps<"/platform/businesses/[id]">, "params">) {
  const { id } = await params
  const data = await getBusiness(id)
  if (!data) notFound()
  return <BusinessDetailView business={data.business} users={data.users} payments={data.payments} />
}
