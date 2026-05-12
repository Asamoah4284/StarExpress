import { getApiBaseUrl } from "@/lib/env.js"

function url(path) {
  const base = getApiBaseUrl().replace(/\/$/, "")
  const p = path.startsWith("/") ? path : `/${path}`
  return `${base}${p}`
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function parseJsonResponse(path, init = {}) {
  const headers = { ...(init.headers || {}) }
  if (init.body != null && headers["Content-Type"] == null) {
    headers["Content-Type"] = "application/json"
  }
  const res = await fetch(url(path), {
    ...init,
    headers,
  })
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_API === "true") {
    const method = init.method || "GET"
    const href =
      typeof window !== "undefined" ? new URL(url(path), window.location.origin).href : url(path)
    console.info(`[StarExpress API] ${method} ${href} → ${res.status}`)
  }
  const text = await res.text()
  /** @type {unknown} */
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { error: text }
    }
  }
  return { res, data }
}

/**
 * @param {string} email
 * @param {string} password
 */
export async function authLogin(email, password) {
  const { res, data } = await parseJsonResponse("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (
    typeof data !== "object" ||
    data === null ||
    typeof data.token !== "string" ||
    typeof data.user !== "object" ||
    data.user === null
  ) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, token: data.token, user: data.user }
}

/**
 * @param {string} name
 * @param {string} email
 * @param {string} password
 */
export async function authSignup(name, email, password) {
  const { res, data } = await parseJsonResponse("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  })
  if (res.status === 409) {
    return { ok: false, code: "exists", error: typeof data === "object" && data && "error" in data ? String(data.error) : "Email taken." }
  }
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, code: "invalid", error: msg }
  }
  if (
    typeof data !== "object" ||
    data === null ||
    typeof data.token !== "string" ||
    typeof data.user !== "object" ||
    data.user === null
  ) {
    return { ok: false, code: "invalid", error: "Unexpected response from server." }
  }
  return { ok: true, token: data.token, user: data.user }
}

/** @param {string} token */
export async function authMe(token) {
  const { res, data } = await parseJsonResponse("/api/auth/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return { ok: false }
  if (typeof data !== "object" || data === null || typeof data.user !== "object" || data.user === null) {
    return { ok: false }
  }
  return { ok: true, user: data.user }
}

/** @param {string} token */
export async function fetchUsersList(token) {
  const { res, data } = await parseJsonResponse("/api/users", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || !Array.isArray(data.users)) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, users: data.users }
}

/**
 * @param {string} token
 * @param {{ name: string, email: string, role: string, password: string }} body
 */
export async function createTeamUser(token, body) {
  const { res, data } = await parseJsonResponse("/api/users", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (res.status === 409) {
    return { ok: false, code: "exists", error: typeof data === "object" && data && "error" in data ? String(data.error) : "Email taken." }
  }
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || typeof data.user !== "object" || data.user === null) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, user: data.user }
}

/**
 * @param {string} token
 * @param {string} id
 * @param {boolean} active
 */
export async function setTeamUserActive(token, id, active) {
  const path = `/api/users/${encodeURIComponent(id)}/active`
  const { res, data } = await parseJsonResponse(path, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ active }),
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  return { ok: true }
}
