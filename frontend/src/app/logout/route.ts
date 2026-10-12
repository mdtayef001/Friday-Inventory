import { NextResponse, type NextRequest } from "next/server"
import { API_URL } from "@/lib/api/config"
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/session"

// Ends the login: blacklists the refresh token in Django and clears both
// cookies. Also where pages send a user whose account was disabled, deleted
// or changed, so they land back on the login page.
export async function GET(req: NextRequest) {
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value
  if (refresh) {
    await fetch(`${API_URL}/auth/logout/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
      cache: "no-store",
    }).catch(() => undefined)
  }
  const res = NextResponse.redirect(new URL("/login", req.nextUrl))
  res.cookies.delete(ACCESS_COOKIE)
  res.cookies.delete(REFRESH_COOKIE)
  return res
}
