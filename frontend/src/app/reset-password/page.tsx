import { Suspense } from "react"
import type { Metadata } from "next"
import { StandalonePage } from "@/components/standalone"
import { ResetPasswordForm } from "./form"

export const metadata: Metadata = { title: "Set a new password" }

export default function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  return (
    <StandalonePage>
      {/* The link's uid and token are only known per request, so they load behind the static frame. */}
      <Suspense>
        <Reset searchParams={searchParams} />
      </Suspense>
    </StandalonePage>
  )
}

async function Reset({ searchParams }: Pick<PageProps<"/reset-password">, "searchParams">) {
  const { uid, token } = await searchParams
  return <ResetPasswordForm uid={typeof uid === "string" ? uid : ""} token={typeof token === "string" ? token : ""} />
}
