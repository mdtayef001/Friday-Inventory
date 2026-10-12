/** The Django API, e.g. http://localhost:8000/api. Only the Next.js server talks to it. */
export const API_URL = (process.env.API_URL ?? "http://localhost:8000/api").replace(/\/$/, "")
