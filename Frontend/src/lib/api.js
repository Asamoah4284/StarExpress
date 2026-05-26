import { getApiBaseUrl, getDefaultAppName, getDefaultCompanyName } from "@/lib/env.js"

/**
 * @param {unknown} data
 */
function parseAppSettingsPayload(data) {
  if (typeof data !== "object" || data === null || typeof data.salesAgentCommissionRate !== "number") {
    return null
  }
  const companyLogoUrl =
    typeof data.companyLogoUrl === "string" && data.companyLogoUrl.trim()
      ? data.companyLogoUrl.trim()
      : null

  return {
    salesAgentCommissionRate: data.salesAgentCommissionRate,
    appName: typeof data.appName === "string" && data.appName.trim() ? data.appName.trim() : getDefaultAppName(),
    companyName:
      typeof data.companyName === "string" && data.companyName.trim()
        ? data.companyName.trim()
        : getDefaultCompanyName(),
    companyLogoUrl,
  }
}

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
    console.info(`[Starexpress API] ${method} ${href} → ${res.status}`)
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
 * @param {string} phone
 */
export async function authSendSignupOtp(phone) {
  const { res, data } = await parseJsonResponse("/api/auth/send-signup-otp", {
    method: "POST",
    body: JSON.stringify({ phone }),
  })
  if (res.status === 429) {
    return { ok: false, code: "cooldown", error: typeof data === "object" && data && "error" in data ? String(data.error) : "Please wait before requesting another code." }
  }
  if (res.status === 409) {
    return { ok: false, code: "exists", error: typeof data === "object" && data && "error" in data ? String(data.error) : "Phone already registered." }
  }
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, code: "invalid", error: msg }
  }
  return { ok: true }
}

/**
 * @param {string} name
 * @param {string} email
 * @param {string} phone
 * @param {string} password
 * @param {string} otp
 */
export async function authSignup(name, email, phone, password, otp) {
  const { res, data } = await parseJsonResponse("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name, email, phone, password, otp }),
  })
  if (res.status === 409) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : "Account already exists."
    const code = /phone/i.test(msg) ? "phone_exists" : "exists"
    return { ok: false, code, error: msg }
  }
  if (res.status === 401) {
    return {
      ok: false,
      code: "otp_invalid",
      error: typeof data === "object" && data && "error" in data ? String(data.error) : "Invalid verification code.",
    }
  }
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    const code = /code|otp|verification/i.test(msg) ? "otp_invalid" : "invalid"
    return { ok: false, code, error: msg }
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

/** @param {string} token */
export async function fetchCatalog(token) {
  const { res, data } = await parseJsonResponse("/api/catalog", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray(data.locations) ||
    !Array.isArray(data.packages) ||
    !Array.isArray(data.sales) ||
    !Array.isArray(data.disputes) ||
    !Array.isArray(data.auditLogs)
  ) {
    return { ok: false, error: "Unexpected response from server." }
  }
  const packageVoucherInventory = Array.isArray(data.packageVoucherInventory)
    ? data.packageVoucherInventory
    : []
  return {
    ok: true,
    catalog: {
      locations: data.locations,
      packages: data.packages,
      sales: data.sales,
      disputes: data.disputes,
      auditLogs: data.auditLogs,
      packageVoucherInventory,
    },
  }
}

/**
 * @param {string} token
 * @param {{ fileName: string, rows: string[][], locationId: string, packageId: string }} body
 */
export async function importVouchersBatch(token, body) {
  const rows = body.rows.map((line) => line.map((cell) => String(cell ?? "")))
  const { res, data } = await parseJsonResponse("/api/catalog/vouchers/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      fileName: body.fileName,
      rows,
      locationId: String(body.locationId ?? "").trim(),
      packageId: String(body.packageId ?? "").trim(),
    }),
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (
    typeof data !== "object" ||
    data === null ||
    typeof data.batchId !== "string" ||
    typeof data.inserted !== "number"
  ) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return {
    ok: true,
    batchId: data.batchId,
    inserted: data.inserted,
    skippedAlreadyInDb: typeof data.skippedAlreadyInDb === "number" ? data.skippedAlreadyInDb : 0,
    skippedDuplicateInFile: typeof data.skippedDuplicateInFile === "number" ? data.skippedDuplicateInFile : 0,
    skippedNoId: typeof data.skippedNoId === "number" ? data.skippedNoId : 0,
    totalRowsInFile: typeof data.totalRowsInFile === "number" ? data.totalRowsInFile : 0,
  }
}

/**
 * @param {string} token
 * @param {{
 *   page?: number
 *   limit?: number
 *   packageId?: string
 *   locationId?: string
 *   status?: string
 * }} [opts]
 */
export async function fetchVouchers(token, opts = {}) {
  const params = new URLSearchParams()
  if (opts.page != null) params.set("page", String(opts.page))
  if (opts.limit != null) params.set("limit", String(opts.limit))
  if (opts.packageId && opts.packageId !== "all") params.set("packageId", opts.packageId)
  if (opts.locationId && opts.locationId !== "all") params.set("locationId", opts.locationId)
  if (opts.status && opts.status !== "all") params.set("status", opts.status)
  const qs = params.toString() ? `?${params.toString()}` : ""
  const { res, data } = await parseJsonResponse(`/api/catalog/vouchers${qs}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray(data.vouchers) ||
    typeof data.total !== "number"
  ) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return {
    ok: true,
    vouchers: data.vouchers,
    total: data.total,
    page: typeof data.page === "number" ? data.page : 1,
    limit: typeof data.limit === "number" ? data.limit : 25,
    totalPages: typeof data.totalPages === "number" ? data.totalPages : 1,
  }
}

/** @param {string} token */
export async function fetchVouchersSummary(token) {
  const { res, data } = await parseJsonResponse("/api/catalog/vouchers/summary", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (
    typeof data !== "object" ||
    data === null ||
    typeof data.totalCount !== "number" ||
    typeof data.unassignedCount !== "number" ||
    !Array.isArray(data.packages)
  ) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return {
    ok: true,
    totalCount: data.totalCount,
    unassignedCount: data.unassignedCount,
    packages: data.packages,
  }
}

/**
 * @param {string} token
 * @param {{ locationId?: string }} [opts]
 */
export async function fetchVoucherStats(token, opts = {}) {
  const params = new URLSearchParams()
  const lid = typeof opts.locationId === "string" ? opts.locationId.trim() : ""
  if (lid && lid !== "all") params.set("locationId", lid)
  const qs = params.toString() ? `?${params.toString()}` : ""
  const { res, data } = await parseJsonResponse(`/api/catalog/vouchers/stats${qs}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || typeof data.total !== "number" || typeof data.remaining !== "number") {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, total: data.total, remaining: data.remaining }
}

/**
 * Total and remaining voucher counts per package (optional location scope for admins).
 * @param {string} token
 * @param {{ locationId?: string }} [opts]
 */
export async function fetchPackageVoucherInventory(token, opts = {}) {
  const params = new URLSearchParams()
  const lid = typeof opts.locationId === "string" ? opts.locationId.trim() : ""
  if (lid && lid !== "all") params.set("locationId", lid)
  const qs = params.toString() ? `?${params.toString()}` : ""
  const { res, data } = await parseJsonResponse(`/api/catalog/packages/voucher-inventory${qs}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || !Array.isArray(data.packages)) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return {
    ok: true,
    locationId: typeof data.locationId === "string" ? data.locationId : null,
    packages: data.packages,
  }
}

/**
 * Remaining unused vouchers for a package at a wifi location.
 * @param {string} token
 * @param {{ packageId: string, locationId: string }} opts
 */
export async function fetchPackageStock(token, opts) {
  const packageId = typeof opts.packageId === "string" ? opts.packageId.trim() : ""
  const locationId = typeof opts.locationId === "string" ? opts.locationId.trim() : ""
  const params = new URLSearchParams()
  if (locationId) params.set("locationId", locationId)
  const qs = params.toString() ? `?${params.toString()}` : ""
  const { res, data } = await parseJsonResponse(
    `/api/catalog/packages/${encodeURIComponent(packageId)}/stock${qs}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || typeof data.remaining !== "number") {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, remaining: data.remaining }
}

/**
 * @param {string} token
 * @param {string} voucherId
 */
export async function deleteVoucher(token, voucherId) {
  const path = `/api/catalog/vouchers/${encodeURIComponent(voucherId)}`
  const { res, data } = await parseJsonResponse(path, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 204) return { ok: true }
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  return { ok: true }
}

/**
 * @param {string} token
 * @param {{ locationId?: string, packageId?: string }} [opts] Scope bulk delete by location and/or package.
 */
export async function deleteAllVouchers(token, opts = {}) {
  const lid = typeof opts.locationId === "string" && opts.locationId.trim() ? opts.locationId.trim() : ""
  const pid = typeof opts.packageId === "string" && opts.packageId.trim() ? opts.packageId.trim() : ""
  const params = new URLSearchParams()
  if (lid) params.set("locationId", lid)
  if (pid) params.set("packageId", pid)
  const qs = params.toString() ? `?${params.toString()}` : ""
  const { res, data } = await parseJsonResponse(`/api/catalog/vouchers${qs}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || typeof data.deleted !== "number") {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, deleted: data.deleted }
}

/** @param {string} token */
export async function fetchAuditLogs(token) {
  const { res, data } = await parseJsonResponse("/api/catalog/audit-logs", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || !Array.isArray(data.auditLogs)) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, auditLogs: data.auditLogs }
}

/**
 * @param {string} token
 * @param {{ name: string, address: string, manager: string, totalSales: number, managerUserId?: string | null }} body
 */
export async function createCatalogLocation(token, body) {
  const { res, data } = await parseJsonResponse("/api/catalog/locations", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || typeof data.location !== "object" || data.location === null) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, location: data.location }
}

/**
 * @param {string} token
 * @param {string} id
 * @param {{
 *   name?: string
 *   address?: string
 *   manager?: string
 *   totalSales?: number
 *   managerUserId?: string | null
 * }} body
 */
export async function updateCatalogLocation(token, id, body) {
  const path = `/api/catalog/locations/${encodeURIComponent(id)}`
  const { res, data } = await parseJsonResponse(path, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || typeof data.location !== "object" || data.location === null) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, location: data.location }
}

/** @param {string} token @param {string} id */
export async function deleteCatalogLocation(token, id) {
  const path = `/api/catalog/locations/${encodeURIComponent(id)}`
  const { res, data } = await parseJsonResponse(path, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  return { ok: true }
}

/**
 * @param {string} token
 * @param {{ name: string, priceGHS: number, dataLimit: string, status: string }} body
 */
export async function createCatalogPackage(token, body) {
  const { res, data } = await parseJsonResponse("/api/catalog/packages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || typeof data.package !== "object" || data.package === null) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, package: data.package }
}

/**
 * Update a package. When `opts.locationId` is supplied the backend scopes the edit to that
 * hostel: if the package is shared with other locations it forks it and re-links only this
 * location's vouchers + sales, leaving the original (and other hostels) untouched.
 *
 * @param {string} token
 * @param {string} id
 * @param {{ name?: string, priceGHS?: number, dataLimit?: string, status?: string }} body
 * @param {{ locationId?: string }} [opts]
 */
export async function updateCatalogPackage(token, id, body, opts = {}) {
  const params = new URLSearchParams()
  const lid = typeof opts.locationId === "string" ? opts.locationId.trim() : ""
  if (lid && lid !== "all") params.set("locationId", lid)
  const qs = params.toString() ? `?${params.toString()}` : ""
  const path = `/api/catalog/packages/${encodeURIComponent(id)}${qs}`
  const { res, data } = await parseJsonResponse(path, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || typeof data.package !== "object" || data.package === null) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return {
    ok: true,
    package: data.package,
    forked: Boolean(data.forked),
    fromPackageId:
      typeof data.fromPackageId === "string" && data.fromPackageId ? data.fromPackageId : undefined,
  }
}

/** @param {string} token @param {string} id */
export async function deleteCatalogPackage(token, id) {
  const path = `/api/catalog/packages/${encodeURIComponent(id)}`
  const { res, data } = await parseJsonResponse(path, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  return { ok: true }
}

/**
 * @param {string} token
 * @param {{
 *   packageId: string
 *   customerPhone: string
 *   customerName?: string
 *   paymentNumber?: string
 *   locationId?: string
 * }} body
 */
export async function createCatalogSale(token, body) {
  const { res, data } = await parseJsonResponse("/api/catalog/sales", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || typeof data.sale !== "object" || data.sale === null) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, sale: data.sale }
}

/** @param {string} token @param {string} id */
export async function resolveCatalogDispute(token, id) {
  const path = `/api/catalog/disputes/${encodeURIComponent(id)}`
  const { res, data } = await parseJsonResponse(path, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: "Resolved" }),
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || typeof data.dispute !== "object" || data.dispute === null) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, dispute: data.dispute }
}

/** @param {string} token */
export async function fetchAppSettings(token) {
  const { res, data } = await parseJsonResponse("/api/settings", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  const settings = parseAppSettingsPayload(data)
  if (!settings) return { ok: false, error: "Unexpected response from server." }
  return { ok: true, ...settings }
}

/**
 * @param {string} token
 * @param {{
 *   salesAgentCommissionPercent?: number
 *   appName?: string
 *   companyName?: string
 *   companyLogoUrl?: string | null
 * }} body
 */
export async function updateAppSettings(token, body) {
  const { res, data } = await parseJsonResponse("/api/settings", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  const settings = parseAppSettingsPayload(data)
  if (!settings) return { ok: false, error: "Unexpected response from server." }
  return { ok: true, ...settings }
}

/**
 * @param {string} token
 * @param {{ salesAgentCommissionPercent: number }} body Percent 0–100
 */
export async function updateAppSettingsCommission(token, body) {
  return updateAppSettings(token, body)
}
