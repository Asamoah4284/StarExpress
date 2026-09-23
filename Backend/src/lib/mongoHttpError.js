import { MongoServerError } from "mongodb"

/**
 * Map MongoDB / driver errors to HTTP status and a safe client message.
 * @param {unknown} err
 * @returns {{ status: number, error: string }}
 */
export function mongoHttpError(err) {
  if (err instanceof MongoServerError && err.code === 11000) {
    const keys = err.keyPattern && typeof err.keyPattern === "object" ? Object.keys(err.keyPattern) : []
    if (keys.includes("managerUserId")) {
      return { status: 409, error: "That sales agent is already assigned to another location." }
    }
    if (keys.includes("name") && keys.includes("orgId")) {
      return { status: 409, error: "A location with this name already exists in your WiFi group." }
    }
    if (keys.includes("name")) {
      return { status: 409, error: "A location with this name already exists." }
    }
    return { status: 409, error: "A record with this value already exists." }
  }
  const name =
    err !== null && typeof err === "object" && "name" in err && typeof err.name === "string"
      ? err.name
      : ""
  const message =
    err !== null && typeof err === "object" && "message" in err && typeof err.message === "string"
      ? err.message
      : ""
  if (
    name === "MongoNetworkError" ||
    name === "MongoServerSelectionError" ||
    name === "MongoTimeoutError" ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("SSL") ||
    message.includes("tlsv1 alert")
  ) {
    return {
      status: 503,
      error:
        "Could not reach the database. Try MONGODB_FAMILY=4 in Backend/.env, confirm Atlas Network Access allows your IP, and use the mongodb+srv URI from Atlas → Connect.",
    }
  }
  const dev =
    process.env.NODE_ENV !== "production" && message ? ` (${message})` : ""
  return { status: 500, error: `Server error.${dev}` }
}
