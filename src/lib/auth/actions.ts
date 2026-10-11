"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { ROLE_HOME } from "./roles"
import { createSession, deleteSession } from "./session"
import { findBusiness } from "./tenants"
import { authenticate, markLogin } from "./users"

export interface LoginState {
  error?: string
  email?: string
}

const LoginSchema = z.object({
  email: z.email("Enter a valid email address").trim(),
  password: z.string().min(1, "Enter your password"),
})

// Simple brute-force protection: 5 failed tries per email locks it for 5 minutes.
const MAX_ATTEMPTS = 5
const LOCK_MS = 5 * 60 * 1000
const attempts = new Map<string, { count: number; lockedUntil: number }>()

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
  const email = String(formData.get("email") ?? "")
  if (!parsed.success) return { error: parsed.error.issues[0].message, email }

  const key = parsed.data.email.toLowerCase()
  const record = attempts.get(key)
  if (record && record.lockedUntil > Date.now()) {
    const minutes = Math.ceil((record.lockedUntil - Date.now()) / 60000)
    return { error: `Too many failed attempts. Try again in ${minutes} minute(s).`, email }
  }

  const user = authenticate(parsed.data.email, parsed.data.password)
  if (!user) {
    const count = (record?.count ?? 0) + 1
    attempts.set(key, { count, lockedUntil: count >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0 })
    return { error: "Incorrect email or password.", email }
  }

  attempts.delete(key)
  let home = ROLE_HOME[user.role]
  if (user.role !== "superadmin") {
    const business = user.tenantId ? findBusiness(user.tenantId) : null
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
  markLogin(user.id)
  await createSession(user.id, user.role)
  redirect(home)
}

export async function logout() {
  await deleteSession()
  redirect("/login")
}
