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
  let res
  try {
    res = await fetch(url(path), { ...init, headers })
  } catch {
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

/** @returns {Promise<{ ok: true, locations: { locationId: string, name: string }[] } | { ok: false, error: string }>} */
export async function fetchPortalLocations() {
  const { res, data } = await fetchWithFallback(["/api/portal/locations", "/ussd/locations", "/ussd/packages"])

  if (!res.ok) {
    return { ok: false, error: data?.error || res.statusText || "Failed to load locations." }
  }

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

    return { ok: true, locations }
  }

  return { ok: true, locations: [] }
}

/**
 * @param {string} locationId
 * @returns {Promise<{ ok: true, locationId: string, locationName: string, packages: object[] } | { ok: false, error: string }>}
 */
export async function fetchPortalPackages(locationId) {
  const q = encodeURIComponent(locationId)
  const { res, data } = await fetchWithFallback([
    `/api/portal/packages?locationId=${q}`,
    `/ussd/packages?locationId=${q}`,
  ])

  if (!res.ok) {
    return { ok: false, error: data?.error || res.statusText || "Failed to load packages." }
  }
  return {
    ok: true,
    locationId: String(data?.locationId || locationId),
    locationName: String(data?.locationName || ""),
    packages: Array.isArray(data?.packages) ? data.packages : [],
  }
}

/**
 * @param {{ locationId: string, packageId: string, customerPhone: string }} body
 */
export async function initializePortalPayment(body) {
  const { res, data } = await parseJsonResponse("/api/portal/payments/initialize", {
    method: "POST",
    body: JSON.stringify(body),
  })
  if (!res.ok || !data || data.success !== true) {
    return {
      ok: false,
      error: data?.error || res.statusText || "Failed to initialize payment.",
    }
  }
  const payload = data.data
  if (!payload?.authorization_url) {
    return { ok: false, error: "Payment gateway did not return a payment URL." }
  }
  return {
    ok: true,
    authorizationUrl: String(payload.authorization_url),
    paymentReference: String(payload.reference || ""),
    redirectUrl: String(payload.redirect_url || ""),
    amount: Number(payload.amount),
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
    return { ok: false, ready: false }
  }
  return {
    ok: true,
    ready: data?.ready === true,
    voucherCode: String(data?.voucherCode || ""),
    packageName: String(data?.packageName || "WiFi"),
    smsSent: data?.smsSent === true,
  }
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
    return {
      ok: false,
      error: data?.error || res.statusText || "Failed to complete payment.",
      retryable: res.status === 409,
    }
  }
  return {
    ok: true,
    voucherCode: String(data.voucherCode || ""),
    packageName: String(data.packageName || "WiFi"),
    smsSent: data.smsSent === true,
    paymentReference: String(data.paymentReference || paymentReference),
  }
}

/**
 * @param {string} paymentReference
 */
export async function completePortalPaymentWithRetry(paymentReference) {
  const delays = [0, 1500, 2000, 2500, 3000, 3500, 4000, 5000]
  let lastError = "Payment verification failed"

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]))
    }
    const result = await completePortalPayment(paymentReference)
    if (result.ok) return result

    lastError = result.error || lastError
    const retryable =
      result.retryable || /processing|verified|confirm|wait/i.test(lastError) || /not verified/i.test(lastError)
    if (!retryable) break
  }

  return { ok: false, error: lastError }
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
    return { ok: false, error: data?.error || res.statusText || "Failed to retrieve vouchers." }
  }
  return {
    ok: true,
    vouchers: Array.isArray(data?.vouchers) ? data.vouchers : [],
    message: typeof data?.message === "string" ? data.message : "",
  }
}
