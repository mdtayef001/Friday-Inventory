import { QueryClient } from "@tanstack/react-query"
import { ApiError } from "@/lib/api/errors"

let browserClient: QueryClient | undefined

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Every change made in the app refreshes what it touched right away, so this
        // only covers changes made by other people: shown pages refetch after 30 seconds
        // when the tab regains focus.
        staleTime: 30_000,
        // A refused or bad request (4xx) won't fix itself; a flaky connection might.
        retry: (failures, err) => failures < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      },
    },
  })
}

/** One cache for the browser session; a fresh one for each server render, so users never share data. */
export function getQueryClient() {
  if (typeof window === "undefined") return makeClient()
  return (browserClient ??= makeClient())
}
