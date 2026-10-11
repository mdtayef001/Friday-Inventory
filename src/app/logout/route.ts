import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE } from "@/lib/auth/session"

// Clears a cookie that is still validly signed but whose account was disabled,
// deleted or changed role, so the user lands back on the login page.
export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.nextUrl))
  res.cookies.delete(SESSION_COOKIE)
  return res
}
