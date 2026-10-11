import { NextResponse, type NextRequest } from "next/server"
import { ROLE_HOME, canAccess, isAppRoute } from "@/lib/auth/roles"
import { SESSION_COOKIE, decrypt } from "@/lib/auth/session"

// First line of defense: a fast cookie check that redirects before any page
// renders. Pages and server actions re-check through the DAL (lib/auth/dal.ts).
export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  const session = await decrypt(req.cookies.get(SESSION_COOKIE)?.value)

  if (path === "/" || path === "/login") {
    if (session) return NextResponse.redirect(new URL(ROLE_HOME[session.role], req.nextUrl))
    return path === "/" ? NextResponse.redirect(new URL("/login", req.nextUrl)) : NextResponse.next()
  }

  if (isAppRoute(path)) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", req.nextUrl))
    }
    if (!canAccess(session.role, path)) {
      return NextResponse.redirect(new URL(ROLE_HOME[session.role], req.nextUrl))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico|webp)$).*)"],
}
