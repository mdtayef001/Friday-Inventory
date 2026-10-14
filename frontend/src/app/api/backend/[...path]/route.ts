import { NextResponse, type NextRequest } from "next/server"
import { API_URL } from "@/lib/api/config"
import { SERVER_TIMEOUT_MS, unreachable } from "@/lib/api/errors"
import { ACCESS_COOKIE } from "@/lib/auth/session"

// The browser's door to Django: forwards the call with the access token from
// the httpOnly cookie (renewed by proxy.ts). Django does every permission check.

const SEGMENT = /^[A-Za-z0-9_-]+$/

async function forward(req: NextRequest, ctx: RouteContext<"/api/backend/[...path]">) {
  const { path } = await ctx.params
  // Only plain path segments, so nothing like "../admin" can reach other Django URLs.
  if (!path.every((s) => SEGMENT.test(s))) return NextResponse.json({ detail: "Not found." }, { status: 404 })

  const hasBody = req.method !== "GET" && req.method !== "HEAD"
  // Forms can't send JSON cross-site, so this also blocks CSRF on top of SameSite cookies.
  if (hasBody && !req.headers.get("content-type")?.startsWith("application/json") && req.method !== "DELETE") {
    return NextResponse.json({ detail: "Send JSON." }, { status: 415 })
  }

  const token = req.cookies.get(ACCESS_COOKIE)?.value
  const res = await fetch(`${API_URL}/${path.join("/")}/${req.nextUrl.search}`, {
    method: req.method,
    headers: {
      Accept: "application/json",
      ...(hasBody && { "Content-Type": "application/json" }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: hasBody ? await req.text() : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
  }).catch((err: unknown) => unreachable(err))

  if (res instanceof Error) return NextResponse.json({ detail: res.message }, { status: res.status })
  if (res.status === 204) return new NextResponse(null, { status: 204 })
  const disposition = res.headers.get("content-disposition")
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
      // File downloads such as the sales CSV.
      ...(disposition && { "Content-Disposition": disposition }),
    },
  })
}

export { forward as GET, forward as POST, forward as PATCH, forward as PUT, forward as DELETE }
