import { getApiBaseUrl } from "@/lib/env.js"

/**
 * @param {string} step
 * @param {unknown} [details]
 */
function buyLog(step, details) {
  if (details === undefined) console.log(`[buy] ${step}`)
  else console.log(`[buy] ${step}`, details)
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
  let res
  try {
    buyLog("api request", { path, method: init.method || "GET", body: init.body })
    res = await fetch(url(path), { ...init, headers })
  } catch (err) {
    buyLog("api network error", { path, error: err instanceof Error ? err.message : String(err) })
    return {
      res: new Response(null, {
        status: 503,
        statusText: "Network error",
      }),
      data: {
        error: "Could not reach the server. Check your internet connection or try again shortly.",
      },
    }
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  buyLog("api response", { path, status: res.status, ok: res.ok, data })
  return { res, data }
}

/**
 * Try paths in order; stop on first non-404 response.
 * @param {string[]} paths
 * @param {RequestInit} [init]
 */
async function fetchWithFallback(paths, init = {}) {
  /** @type {{ res: Response, data: unknown } | null} */
  let last = null
  for (const path of paths) {
    const result = await parseJsonResponse(path, init)
    last = result
    if (result.res.ok || result.res.status !== 404) return result
  }
  return last || { res: new Response(null, { status: 404 }), data: null }
}

/**
 * @param {string} [orgId]
 * @returns {Promise<{ ok: true, locations: { locationId: string, name: string }[], enquiryPhone: string } | { ok: false, error: string }>}
 */
export async function fetchPortalLocations(orgId = "") {
  const q = orgId ? `?org=${encodeURIComponent(orgId)}` : ""
  const { res, data } = await fetchWithFallback([
    `/api/portal/locations${q}`,
    `/ussd/locations${q}`,
    `/ussd/packages${q}`,
  ])

  if (!res.ok) {
    return { ok: false, error: data?.error || res.statusText || "Failed to load locations." }
  }

  const enquiryPhone =
    typeof data?.enquiryPhone === "string" && data.enquiryPhone.trim() ? data.enquiryPhone.trim() : ""

  if (Array.isArray(data?.locations)) {
    const locations = data.locations.map((loc) => {
      if (loc && typeof loc === "object" && "locationId" in loc) {
        return {
          locationId: String(loc.locationId),
          name: typeof loc.name === "string" ? loc.name : String(loc.locationId),
        }
      }
      return null
    }).filter(Boolean)

    return { ok: true, locations, enquiryPhone }
  }

  return { ok: true, locations: [], enquiryPhone }
}

/**
 * @param {string} locationId
 * @param {string} [orgId]
 * @returns {Promise<{ ok: true, locationId: string, locationName: string, packages: object[] } | { ok: false, error: string }>}
 */
export async function fetchPortalPackages(locationId, orgId = "") {
  const params = new URLSearchParams({ locationId })
  if (orgId) params.set("org", orgId)
  const q = params.toString()
  const { res, data } = await fetchWithFallback([
    `/api/portal/packages?${q}`,
    `/ussd/packages?${q}`,
  ])

  if (!res.ok) {
    return { ok: false, error: data?.error || res.statusText || "Failed to load packages." }
  }
  const promoRaw = data?.promo
  const promo =
    promoRaw && typeof promoRaw === "object" && typeof promoRaw.code === "string" && promoRaw.code.trim()
      ? {
          code: String(promoRaw.code).trim(),
          message: String(promoRaw.message || "").trim(),
          percentOff: Number.isFinite(Number(promoRaw.percentOff)) ? Number(promoRaw.percentOff) : 0,
        }
      : null
  return {
    ok: true,
    locationId: String(data?.locationId || locationId),
    locationName: String(data?.locationName || ""),
    packages: Array.isArray(data?.packages) ? data.packages : [],
    promo,
  }
}

/**
 * @param {{
 *   locationId: string
 *   packageId: string
 *   customerPhone: string
 *   promoCode?: string
 *   login_url?: string
 *   ap_mac?: string
 *   client_mac?: string
 *   orig_url?: string
 *   ssid?: string
 *   org?: string
 * }} body
 */
export async function initializePortalPayment(body) {
  const payloadBody = {
    locationId: body.locationId,
    packageId: body.packageId,
    customerPhone: body.customerPhone,
    ...(body.promoCode ? { promoCode: body.promoCode } : {}),
    ...(body.login_url ? { login_url: body.login_url } : {}),
    ...(body.ap_mac ? { ap_mac: body.ap_mac } : {}),
    ...(body.client_mac ? { client_mac: body.client_mac } : {}),
    ...(body.orig_url ? { orig_url: body.orig_url } : {}),
    ...(body.ssid ? { ssid: body.ssid } : {}),
    ...(body.org ? { org: body.org } : {}),
  }
  const { res, data } = await parseJsonResponse("/api/portal/payments/initialize", {
    method: "POST",
    body: JSON.stringify(payloadBody),
  })
  if (!res.ok || !data || data.success !== true) {
    buyLog("initialize failed", { status: res.status, data })
    return {
      ok: false,
      error: data?.error || res.statusText || "Failed to initialize payment.",
    }
  }
  const payload = data.data
  if (!payload?.authorization_url) {
    buyLog("initialize missing authorization_url", { data })
    return { ok: false, error: "Payment gateway did not return a payment URL." }
  }
  const result = {
    ok: true,
    authorizationUrl: String(payload.authorization_url),
    paymentReference: String(payload.reference || ""),
    redirectUrl: String(payload.redirect_url || ""),
    amount: Number(payload.amount),
    originalAmount: Number(payload.originalAmount ?? payload.amount),
    promoPercentOff: Number(payload.promoPercentOff ?? 0),
  }
  buyLog("initialize ok", result)
  return result
}

/**
 * @param {unknown} data
 */
function hotspotFromPayload(data) {
  const src = data && typeof data === "object" ? /** @type {Record<string, unknown>} */ (data) : {}
  return {
    login_url: String(src.login_url || ""),
    ap_mac: String(src.ap_mac || ""),
    client_mac: String(src.client_mac || ""),
    orig_url: String(src.orig_url || ""),
    ssid: String(src.ssid || ""),
    authorizeUrl:
      typeof src.authorizeUrl === "string" && src.authorizeUrl.trim() ? src.authorizeUrl.trim() : "",
  }
}

/**
 * Lightweight poll: is the sale fulfilled yet? Used while the Moolre POS iframe is open.
 * @param {string} paymentReference
 */
export async function fetchPortalPaymentStatus(paymentReference) {
  const { res, data } = await parseJsonResponse(
    `/api/portal/payments/status?paymentReference=${encodeURIComponent(paymentReference)}`,
  )
  if (!res.ok) {
    buyLog("status not ok", { paymentReference, status: res.status, data })
    return { ok: false, ready: false }
  }
  const hotspot = hotspotFromPayload(data)
  const result = {
    ok: true,
    ready: data?.ready === true,
    voucherCode: String(data?.voucherCode || ""),
    packageName: String(data?.packageName || "WiFi"),
    smsSent: data?.smsSent === true,
    ...hotspot,
  }
  buyLog("status result", {
    paymentReference,
    ready: result.ready,
    voucherCode: result.voucherCode,
    hasLoginUrl: Boolean(result.login_url),
  })
  return result
}

/**
 * @param {string} paymentReference
 */
export async function completePortalPayment(paymentReference) {
  const { res, data } = await parseJsonResponse("/api/portal/payments/complete", {
    method: "POST",
    body: JSON.stringify({ paymentReference }),
  })
  if (!res.ok || !data || data.success !== true) {
    buyLog("complete failed", { paymentReference, status: res.status, data })
    return {
      ok: false,
      error: data?.error || res.statusText || "Failed to complete payment.",
      retryable: res.status === 409,
    }
  }
  const hotspot = hotspotFromPayload(data)
  const result = {
    ok: true,
    voucherCode: String(data.voucherCode || ""),
    packageName: String(data.packageName || "WiFi"),
    smsSent: data.smsSent === true,
    paymentReference: String(data.paymentReference || paymentReference),
    hotspot: data.hotspot === true,
    ...hotspot,
  }
  buyLog("complete ok", {
    paymentReference: result.paymentReference,
    voucherCode: result.voucherCode,
    hasLoginUrl: Boolean(result.login_url),
  })
  return result
}

/**
 * After captive payment success: ask the backend to write RADIUS credentials and
 * return the Grandstream login_url the browser must hit (hotspot purchases only).
 * @param {string} paymentReference
 * @param {{
 *   login_url?: string
 *   ap_mac?: string
 *   client_mac?: string
 *   orig_url?: string
 *   ssid?: string
 * }} [portalParams]
 */
export async function authorizePortalRadius(paymentReference, portalParams = {}) {
  const payload = {
    paymentReference,
    ...(portalParams.login_url ? { login_url: portalParams.login_url } : {}),
    ...(portalParams.ap_mac ? { ap_mac: portalParams.ap_mac } : {}),
    ...(portalParams.client_mac ? { client_mac: portalParams.client_mac } : {}),
    ...(portalParams.orig_url ? { orig_url: portalParams.orig_url } : {}),
    ...(portalParams.ssid ? { ssid: portalParams.ssid } : {}),
  }
  const { res, data } = await parseJsonResponse("/api/portal/payments/radius-authorize", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  if (res.status === 409) {
    return {
      ok: false,
      retryable: true,
      error: data?.error || "Payment is still processing.",
      authorizeUrl: null,
      hotspot: false,
    }
  }
  if (!res.ok || !data || data.success !== true) {
    return {
      ok: false,
      retryable: false,
      error: data?.error || res.statusText || "Failed to authorize WiFi access.",
      authorizeUrl: null,
      hotspot: false,
    }
  }
  const authorizeUrl =
    typeof data.authorizeUrl === "string" && data.authorizeUrl.trim() ? data.authorizeUrl.trim() : null
  const voucherCode = typeof data.voucherCode === "string" ? data.voucherCode : ""
  buyLog("radius-authorize ok", { paymentReference, hotspot: data.hotspot === true, voucherCode, authorizeUrl })
  return {
    ok: true,
    hotspot: data.hotspot === true,
    authorizeUrl,
    voucherCode,
  }
}

/**
 * Retry radius authorize a few times (sale may still be writing).
 * @param {string} paymentReference
 * @param {{
 *   login_url?: string
 *   ap_mac?: string
 *   client_mac?: string
 *   orig_url?: string
 *   ssid?: string
 * }} [portalParams]
 */
export async function authorizePortalRadiusWithRetry(paymentReference, portalParams = {}) {
  const delays = [0, 1000, 1500, 2000, 2500]
  let last = /** @type {Awaited<ReturnType<typeof authorizePortalRadius>>} */ ({
    ok: false,
    retryable: true,
    error: "Authorization pending",
    authorizeUrl: null,
    hotspot: false,
  })
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]))
    last = await authorizePortalRadius(paymentReference, portalParams)
    if (last.ok && last.authorizeUrl) return last
    if (!last.retryable) break
  }
  return last
}

/**
 * @param {string} phone
 */
export async function retrievePortalVouchers(phone) {
  const { res, data } = await parseJsonResponse("/api/portal/vouchers/retrieve", {
    method: "POST",
    body: JSON.stringify({ phone }),
  })
  if (!res.ok) {
    buyLog("retrieve failed", { phone, status: res.status, data })
    return { ok: false, error: data?.error || res.statusText || "Failed to retrieve vouchers." }
  }
  const result = {
    ok: true,
    vouchers: Array.isArray(data?.vouchers) ? data.vouchers : [],
    message: typeof data?.message === "string" ? data.message : "",
  }
  buyLog("retrieve ok", { count: result.vouchers.length, vouchers: result.vouchers })
  return result
}
