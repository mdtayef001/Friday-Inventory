import type { Metadata } from "next"
import { getBusinesses } from "@/lib/auth/platform-actions"
import { PlatformOverview } from "./view"

export const metadata: Metadata = { title: "Platform" }

export default async function PlatformPage() {
  return <PlatformOverview businesses={await getBusinesses()} />
}
