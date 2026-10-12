"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { api } from "@/lib/api/server"
import { ApiError } from "@/lib/api/errors"
import type { Business, SessionUser } from "@/lib/types"
import { ROLE_HOME } from "./roles"
import { createSession, deleteSession } from "./session"

export interface LoginState {
  error?: string
  email?: string
}

const LoginSchema = z.object({
  email: z.email("Enter a valid email address").trim(),
  password: z.string().min(1, "Enter your password"),
})

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
  const email = String(formData.get("email") ?? "")
  if (!parsed.success) return { error: parsed.error.issues[0].message, email }

  // Django checks the password and limits failed attempts per email.
  let tokens: { access: string; refresh: string; user: SessionUser }
  try {
    tokens = await api("auth/login/", { method: "POST", body: parsed.data, token: null })
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      return { error: "Too many failed attempts. Try again in a minute.", email }
    }
    if (err instanceof ApiError && err.status < 500) return { error: "Incorrect email or password.", email }
    return { error: "Couldn't reach the server. Please try again.", email }
  }

  const { user } = tokens
  let home = ROLE_HOME[user.role]
  if (user.role !== "superadmin") {
    const { business } = await api<{ business: Business | null }>("auth/me/", { token: tokens.access })
    if (!business) return { error: "Your business account no longer exists.", email }
    if (business.status === "suspended") {
      return { error: `${business.name} is suspended. Please contact support to restore access.`, email }
    }
    if (business.status === "unpaid") {
      // The owner can log in to pay; everyone else waits for the owner.
      if (user.role !== "owner") {
        return { error: `The subscription for ${business.name} has ended. Ask the owner to renew it.`, email }
      }
      home = "/subscribe"
    }
  }
  await createSession(tokens)
  redirect(home)
}

export async function logout() {
  await deleteSession()
  redirect("/login")
}
