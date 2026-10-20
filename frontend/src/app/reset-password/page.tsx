import type { Metadata } from "next"
import { StandalonePage } from "@/components/standalone"
import { ResetPasswordForm } from "./form"

export const metadata: Metadata = { title: "Set a new password" }

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { uid, token } = await searchParams
  return (
    <StandalonePage>
      <ResetPasswordForm uid={typeof uid === "string" ? uid : ""} token={typeof token === "string" ? token : ""} />
    </StandalonePage>
  )
}
