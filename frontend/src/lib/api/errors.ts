// Turns a Django REST Framework error body into one readable sentence.
// Shared by the server and browser API clients.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export function errorMessage(data: unknown, status: number): string {
  const first = (value: unknown): string | null => {
    if (typeof value === "string") return value
    if (Array.isArray(value)) return value.map(first).find(Boolean) ?? null
    if (value && typeof value === "object") return Object.values(value).map(first).find(Boolean) ?? null
    return null
  }
  const message = first(data)
  if (message) return message
  if (status === 403) return "You don't have permission to do that."
  if (status === 404) return "Not found. It may have been deleted."
  if (status >= 500) return "The server ran into a problem. Please try again."
  return "Something went wrong."
}

/** How long the Next.js server waits for Django before giving up. */
export const SERVER_TIMEOUT_MS = 15_000

/** A call that never got an answer: offline, the server is down, or it took too long. */
export function unreachable(err: unknown): ApiError {
  return err instanceof DOMException && err.name === "TimeoutError"
    ? new ApiError(504, "The server took too long to answer. Please try again.")
    : new ApiError(503, "Couldn't reach the server. Check your connection and try again.")
}
