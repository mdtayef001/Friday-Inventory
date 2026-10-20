import type { Metadata } from "next"
import { StandalonePage } from "@/components/standalone"
import { ForgotPasswordForm } from "./form"

export const metadata: Metadata = { title: "Forgot password" }

export default function ForgotPasswordPage() {
  return (
    <StandalonePage>
      <ForgotPasswordForm />
    </StandalonePage>
  )
}
