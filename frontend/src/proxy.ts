import { NextResponse, type NextRequest } from "next/server"
import { ROLE_HOME, canAccess, isAppRoute } from "@/lib/auth/roles"
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions, refreshAccess, verifyAccess } from "@/lib/auth/session"

// First line of defense: a fast token check that redirects before any page
// renders. It also renews the short-lived access token from the refresh token,
// so pages, server actions and /api/backend always see a valid one. Pages
// re-check through the DAL (lib/auth/dal.ts) and Django checks every API call.
export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  let session = await verifyAccess(req.cookies.get(ACCESS_COOKIE)?.value)
  let renewed: string | null = null
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value
  if (!session && refresh) {
    renewed = await refreshAccess(refresh)
    session = await verifyAccess(renewed ?? undefined)
    // Hand the new token to whatever renders this request.
    if (renewed) req.cookies.set(ACCESS_COOKIE, renewed)
  }

  const res = route(req, path, session)
  if (renewed) res.cookies.set(ACCESS_COOKIE, renewed, cookieOptions(ACCESS_COOKIE))
  else if (refresh && !session) {
    // The login ended or was logged out elsewhere: clear the dead cookies.
    res.cookies.delete(ACCESS_COOKIE)
    res.cookies.delete(REFRESH_COOKIE)
  }
  return res
}

function route(req: NextRequest, path: string, session: Awaited<ReturnType<typeof verifyAccess>>) {
  const next = () => NextResponse.next({ request: { headers: req.headers } })
  if (path.startsWith("/api/")) return next()

  if (path === "/" || path === "/login") {
    if (session) return NextResponse.redirect(new URL(ROLE_HOME[session.role], req.nextUrl))
    return path === "/" ? NextResponse.redirect(new URL("/login", req.nextUrl)) : next()
  }

  if (isAppRoute(path)) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", req.nextUrl))
    }
    if (!canAccess(session, path)) {
      return NextResponse.redirect(new URL(ROLE_HOME[session.role], req.nextUrl))
    }
  }

  return next()
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico|webp)$).*)",
    // The browser's API calls, so their token gets renewed too.
    "/api/backend/:path*",
  ],
}
