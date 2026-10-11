import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getBusiness } from "@/lib/auth/platform-actions"
import { BusinessDetailView } from "./view"

export const metadata: Metadata = { title: "Business" }

export default async function BusinessPage({ params }: PageProps<"/platform/businesses/[id]">) {
  const { id } = await params
  const data = await getBusiness(id)
  if (!data) notFound()
  return <BusinessDetailView business={data.business} users={data.users} payments={data.payments} />
}
