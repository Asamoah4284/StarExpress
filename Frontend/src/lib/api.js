import { getApiBaseUrl, getDefaultAppName, getDefaultCompanyName } from "@/lib/env.js"
import { enrichCustomerRow, summarizeCustomers } from "@/lib/customerAnalytics.js"
import { formatGhanaPhoneLocal, ghanaPhoneDedupeKey } from "@/lib/ghanaPhone.js"

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
    alertPhone: typeof data.alertPhone === "string" ? data.alertPhone.trim() : "",
    purchaseAlertsEnabled: typeof data.purchaseAlertsEnabled === "boolean" ? data.purchaseAlertsEnabled : true,
    promosVisible: typeof data.promosVisible === "boolean" ? data.promosVisible : true,
  }
}

function url(path) {
  const base = getApiBaseUrl().replace(/\/$/, "")
  const p = path.startsWith("/") ? path : `/${path}`
  return `${base}${p}`
}

/** @param {Response} res @param {unknown} data */
function apiErrorMessage(res, data) {
  if (typeof data === "object" && data && "error" in data) {
    const err = String(data.error)
    if (err.includes("<!DOCTYPE") || err.includes("Cannot GET") || err.includes("Cannot POST")) {
      if (res.status === 404) {
        return "This feature is not available on the server yet. Redeploy the backend API to enable it."
      }
      return res.statusText || "Request failed."
    }
    if (err.length > 200) return res.statusText || "Request failed."
    return err
  }
  return res.statusText || "Request failed."
}

function roundMoney(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.round(x * 100) / 100
}

/**
 * @param {unknown} c
 */
function normalizeCustomer(c) {
  const row = {
    phone: String(c?.phone || ""),
    purchases: Number(c?.purchases) || 0,
    totalSpent: Number(c?.totalSpent) || 0,
    firstPurchase: typeof c?.firstPurchase === "string" ? c.firstPurchase : "",
    lastPurchase: typeof c?.lastPurchase === "string" ? c.lastPurchase : "",
    activeDays: Number(c?.activeDays) || 0,
    daysSinceLastPurchase:
      c?.daysSinceLastPurchase != null && Number.isFinite(Number(c.daysSinceLastPurchase))
        ? Number(c.daysSinceLastPurchase)
        : null,
    avgDaysBetweenPurchases:
      c?.avgDaysBetweenPurchases != null && Number.isFinite(Number(c.avgDaysBetweenPurchases))
        ? Number(c.avgDaysBetweenPurchases)
        : null,
    segment: typeof c?.segment === "string" ? c.segment : undefined,
  }
  return enrichCustomerRow(row)
}

/**
 * @param {unknown} data
 */
function normalizeCustomerSummary(data, customers) {
  if (typeof data === "object" && data != null && typeof data.summary === "object" && data.summary != null) {
    const s = data.summary
    return {
      total: Number(s.total) || customers.length,
      active: Number(s.active) || 0,
      inactive: Number(s.inactive) || 0,
      repeat: Number(s.repeat) || 0,
      oneTime: Number(s.oneTime) || 0,
      inactiveThresholdDays: Number(s.inactiveThresholdDays) || 5,
    }
  }
  return summarizeCustomers(customers)
}

/**
 * @param {Array<string | { phone?: string, purchases?: number, totalSpent?: number, firstPurchase?: string, lastPurchase?: string, activeDays?: number, daysSinceLastPurchase?: number | null, avgDaysBetweenPurchases?: number | null, segment?: string }>} rows
 */
function mergeAndSortCustomers(rows) {
  /** @type {Map<string, { phone: string, purchases: number, totalSpent: number, firstPurchase: string, lastPurchase: string, activeDays: number }>} */
  const byKey = new Map()
  for (const row of rows) {
    const phone = typeof row === "string" ? row : String(row?.phone || "")
    if (!phone) continue
    const key = ghanaPhoneDedupeKey(phone)
    const local = formatGhanaPhoneLocal(phone)
    if (!key || key.length < 7 || !local) continue

    const purchases =
      typeof row === "object" && row != null && "purchases" in row ? Number(row.purchases) || 0 : 1
    const totalSpent = typeof row === "object" && row != null ? Number(row.totalSpent) || 0 : 0
    const lastPurchase =
      typeof row === "object" && row != null && typeof row.lastPurchase === "string"
        ? row.lastPurchase
        : ""
    const firstPurchase =
      typeof row === "object" && row != null && typeof row.firstPurchase === "string"
        ? row.firstPurchase
        : lastPurchase
    const activeDays = typeof row === "object" && row != null ? Number(row.activeDays) || 0 : 0

    const existing = byKey.get(key)
    if (existing) {
      existing.purchases += purchases || 1
      existing.totalSpent = roundMoney(existing.totalSpent + totalSpent)
      existing.activeDays = Math.max(existing.activeDays, activeDays)
      if (lastPurchase && lastPurchase > existing.lastPurchase) existing.lastPurchase = lastPurchase
      if (firstPurchase && (!existing.firstPurchase || firstPurchase < existing.firstPurchase)) {
        existing.firstPurchase = firstPurchase
      }
    } else {
      byKey.set(key, {
        phone: local,
        purchases: purchases || 1,
        totalSpent: roundMoney(totalSpent),
        firstPurchase: firstPurchase || lastPurchase,
        lastPurchase,
        activeDays,
      })
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => {
      if (b.purchases !== a.purchases) return b.purchases - a.purchases
      if (b.activeDays !== a.activeDays) return b.activeDays - a.activeDays
      if (b.totalSpent !== a.totalSpent) return b.totalSpent - a.totalSpent
      return a.phone.localeCompare(b.phone, undefined, { numeric: true })
    })
    .map((row) => enrichCustomerRow(row))
}

/**
 * Fallback when GET /catalog/customers is missing on an older API deployment.
 * @param {string} token
 * @param {string} locationId
 * @param {Array<{ id: string, name?: string }>} locations
 * @param {string} [agentLocationId]
 */
async function fetchCustomersViaLocations(token, locationId, locations, agentLocationId) {
  const scope = locationId || "all"
  /** @type {Array<{ id: string, name?: string }>} */
  let targetLocations = locations

  if (agentLocationId) {
    targetLocations = locations.filter((l) => l.id === agentLocationId)
    if (targetLocations.length === 0) {
      return {
        ok: false,
        error: "No location is assigned to your sales account. Ask an administrator to link you to a store.",
      }
    }
  } else if (scope !== "all") {
    targetLocations = locations.filter((l) => l.id === scope)
    if (targetLocations.length === 0) {
      return { ok: false, error: "Location not found." }
    }
  }

  /** @type {Array<{ phone?: string, purchases?: number, totalSpent?: number, lastPurchase?: string, activeDays?: number } | string>} */
  const allRows = []
  for (const loc of targetLocations) {
    const result = await fetchLocationCustomerNumbers(token, loc.id)
    if (!result.ok) {
      if (targetLocations.length === 1) return result
      continue
    }
    allRows.push(...result.customers)
  }

  const customers = mergeAndSortCustomers(allRows)
  const resolvedScope = agentLocationId || scope
  const scopeLabel = agentLocationId
    ? String(targetLocations[0]?.name || "Your store")
    : scope === "all"
      ? "All locations"
      : String(targetLocations[0]?.name || scope)

  return {
    ok: true,
    scope: resolvedScope,
    scopeLabel,
    totalUniqueNumbers: customers.length,
    summary: summarizeCustomers(customers),
    top: customers.slice(0, 5),
    customers,
  }
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
 * Set (or clear) the promo shown to buyers for a location. Empty code+message clears it.
 * @param {string} token
 * @param {string} locationId
 * @param {{ code: string, message: string, active: boolean, percentOff?: number }} body
 */
export async function setLocationPromo(token, locationId, body) {
  const { res, data } = await parseJsonResponse(
    `/api/catalog/locations/${encodeURIComponent(locationId)}/promo`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        code: String(body.code ?? "").trim(),
        message: String(body.message ?? "").trim(),
        active: body.active === true,
        percentOff: Number.isFinite(Number(body.percentOff)) ? Number(body.percentOff) : 0,
      }),
    },
  )
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText
    return { ok: false, error: msg }
  }
  if (typeof data !== "object" || data === null || typeof data.location !== "object") {
    return { ok: false, error: "Unexpected response from server." }
  }
  return { ok: true, location: data.location }
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
 *   search?: string
 * }} [opts]
 */
export async function fetchVouchers(token, opts = {}) {
  const params = new URLSearchParams()
  if (opts.page != null) params.set("page", String(opts.page))
  if (opts.limit != null) params.set("limit", String(opts.limit))
  if (opts.packageId && opts.packageId !== "all") params.set("packageId", opts.packageId)
  if (opts.locationId && opts.locationId !== "all") params.set("locationId", opts.locationId)
  if (opts.status && opts.status !== "all") params.set("status", opts.status)
  const search = typeof opts.search === "string" ? opts.search.trim() : ""
  if (search) params.set("search", search.slice(0, 64))
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
 * Unique customer phone numbers that have ever purchased at a wifi location.
 * @param {string} token
 * @param {string} locationId
 */
export async function fetchLocationCustomerNumbers(token, locationId) {
  const path = `/api/catalog/locations/${encodeURIComponent(locationId)}/customer-numbers`
  const { res, data } = await parseJsonResponse(path, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const msg = apiErrorMessage(res, data)
    return { ok: false, error: msg }
  }
  const rawList = Array.isArray(data?.customers)
    ? data.customers
    : Array.isArray(data?.phones)
      ? data.phones
      : null
  if (typeof data !== "object" || data === null || !rawList) {
    return { ok: false, error: "Unexpected response from server." }
  }
  return {
    ok: true,
    locationId: String(data.locationId || locationId),
    locationName: String(data.locationName || ""),
    totalUniqueNumbers: Number(data.totalUniqueNumbers) || rawList.length,
    customers: rawList.map((c) => {
      if (typeof c === "string") {
        return { phone: c, purchases: 0, totalSpent: 0, lastPurchase: "", activeDays: 0 }
      }
      return {
        phone: String(c?.phone || ""),
        purchases: Number(c?.purchases) || 0,
        totalSpent: Number(c?.totalSpent) || 0,
        lastPurchase: typeof c?.lastPurchase === "string" ? c.lastPurchase : "",
        activeDays: Number(c?.activeDays) || 0,
      }
    }),
  }
}

/**
 * Customers across all locations (locationId omitted/"all") or one location, ranked by
 * how consistently they buy. Sales agents are always scoped to their store server-side.
 * @param {string} token
 * @param {string} [locationId] "" or "all" for every location, or a specific location id
 * @param {{ locations?: Array<{ id: string, name?: string }>, agentLocationId?: string }} [options]
 */
export async function fetchCustomers(token, locationId = "all", options = {}) {
  const q = encodeURIComponent(locationId || "all")
  const { res, data } = await parseJsonResponse(`/api/catalog/customers?locationId=${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 404) {
    let locations = options.locations
    if (!locations?.length) {
      const catalogResult = await fetchCatalog(token)
      if (!catalogResult.ok) {
        return { ok: false, error: catalogResult.error || "Failed to load customers." }
      }
      locations = catalogResult.catalog.locations
    }
    return fetchCustomersViaLocations(token, locationId, locations, options.agentLocationId)
  }

  if (!res.ok) {
    return { ok: false, error: apiErrorMessage(res, data) }
  }
  if (typeof data !== "object" || data === null || !Array.isArray(data.customers)) {
    return { ok: false, error: "Unexpected response from server." }
  }
  const customers = data.customers.map(normalizeCustomer)
  return {
    ok: true,
    scope: String(data.scope || "all"),
    scopeLabel: String(data.scopeLabel || "All locations"),
    totalUniqueNumbers: Number(data.totalUniqueNumbers) || customers.length,
    summary: normalizeCustomerSummary(data, customers),
    top: Array.isArray(data.top) ? data.top.map(normalizeCustomer) : customers.slice(0, 5),
    customers,
  }
}

/**
 * Send an SMS update to one customer (`phone`) or broadcast to everyone in the current
 * scope (`locationId` "all" or a specific id). Sales agents are scoped to their store.
 * @param {string} token
 * @param {{ locationId?: string, phone?: string, phones?: string[], message: string }} body
 */
export async function sendCustomersSms(token, body) {
  const { res, data } = await parseJsonResponse("/api/catalog/customers/sms", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      locationId: body.locationId || "all",
      ...(body.phone ? { phone: body.phone } : {}),
      ...(Array.isArray(body.phones) && body.phones.length > 0 ? { phones: body.phones } : {}),
      message: String(body.message ?? ""),
    }),
  })
  if (!res.ok || !data || data.ok !== true) {
    return { ok: false, error: apiErrorMessage(res, data) || "Failed to send SMS." }
  }
  return {
    ok: true,
    total: Number(data.total) || 0,
    sent: Number(data.sent) || 0,
    failed: Number(data.failed) || 0,
  }
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
 *   paymentReference?: string
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
  return {
    ok: true,
    sale: data.sale,
    smsSent: data.smsSent === true,
    idempotent: data.idempotent === true,
  }
}

/**
 * Complete an agent MoMo sale — retries while Moolre status or webhook fulfillment catches up.
 * @param {string} token
 * @param {Parameters<typeof createCatalogSale>[1]} body
 */
export async function createCatalogSaleWithPaymentRetry(token, body) {
  const delays = [0, 1500, 2000, 2500, 3000, 3500, 4000, 5000]
  let lastError = "Sale failed"

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]))
    }
    const result = await createCatalogSale(token, body)
    if (result.ok) return result

    lastError = result.error || lastError
    const retryable =
      /processing|verified|confirm|wait/i.test(lastError) || /payment not verified/i.test(lastError)
    if (!retryable) break
  }

  return { ok: false, error: lastError }
}

/**
 * Start Moolre embed payment for an agent product sale (MoMo prompt on customer phone).
 * @param {string} token
 * @param {{ packageId: string, customerPhone: string, locationId?: string }} body
 */
export async function initializeAgentMoolrePayment(token, body) {
  const { res, data } = await parseJsonResponse("/api/catalog/sales/initialize-moolre-payment", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok || !data || typeof data !== "object" || data.success !== true) {
    const msg =
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : typeof data === "object" && data && "message" in data
          ? String(data.message)
          : res.statusText
    return { ok: false, error: msg }
  }
  const payload = data.data
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.authorization_url !== "string" ||
    typeof payload.reference !== "string"
  ) {
    return { ok: false, error: "Unexpected response from payment gateway." }
  }
  return {
    ok: true,
    authorization_url: payload.authorization_url,
    reference: payload.reference,
    redirect_url: typeof payload.redirect_url === "string" ? payload.redirect_url : null,
    amount: typeof payload.amount === "number" ? payload.amount : null,
  }
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
 *   alertPhone?: string | null
 *   purchaseAlertsEnabled?: boolean
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
