import { randomUUID } from "node:crypto"
import { checkMoolrePaymentStatus } from "./moolrePaymentStatus.js"
import { resolveMoolreRedirectUrl, resolveMoolreWebhookUrl } from "./moolrePaymentUrls.js"
import { getMoolrePaymentAuthHeaders } from "./ussdHelpers.js"
import { buyLog, buyError } from "./buyLog.js"

const MOOLRE_ACCOUNT_NUMBER = String(process.env.MOOLRE_ACCOUNT_NUMBER || "").replace(/\s/g, "")
const MOOLRE_EMBED_URL = "https://api.moolre.com/embed/link"

/**
 * Domain Moolre can resolve. Fake @phone.starexpress.app used to work until their
 * validator started treating unknown mail domains as IE01 INTERNAL ERROR.
 */
function billingEmailDomain() {
  const fromEnv = String(process.env.MOOLRE_BILLING_EMAIL || "").trim()
  const at = fromEnv.lastIndexOf("@")
  if (at > 0) return fromEnv.slice(at + 1).toLowerCase()
  for (const raw of [process.env.FRONTEND_URL, process.env.BACKEND_URL]) {
    try {
      const host = new URL(String(raw || "").trim()).hostname.replace(/^www\./i, "")
      if (host && host.includes(".")) return host.toLowerCase()
    } catch {
      /* ignore */
    }
  }
  return "tabitacum.cloud"
}

/**
 * @param {string} phone
 */
export function billingEmailFromPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "")
  if (digits.length < 7) return null
  const explicit = String(process.env.MOOLRE_BILLING_EMAIL || "").trim()
  if (explicit.includes("@")) return explicit
  return `${digits}@${billingEmailDomain()}`
}

/**
 * @param {unknown} amount
 */
function formatMoolreAmount(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return ""
  return n.toFixed(2)
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
function stringifyMetadata(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  /** @type {Record<string, string>} */
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || value === "") continue
    out[String(key).slice(0, 40)] = String(value).slice(0, 200)
  }
  return out
}

/**
 * @param {string} [suffix]
 */
export function generateAgentPaymentReference(suffix = "") {
  const tag = suffix ? String(suffix).slice(0, 12) : randomUUID().slice(0, 8)
  return `SE-AGENT-${Date.now().toString(36).toUpperCase()}-${tag}`
}

/**
 * @param {{
 *   amount: number
 *   email: string
 *   externalref: string
 *   metadata?: Record<string, string>
 *   redirectUrl?: string
 * }} opts
 */
export async function initializeMoolreEmbedLink(opts) {
  const { amount, email, externalref, metadata = {}, redirectUrl: redirectOverride } = opts

  if (!MOOLRE_ACCOUNT_NUMBER || !process.env.MOOLRE_USERNAME || !process.env.MOOLRE_PUBLIC_KEY) {
    return { ok: false, error: "Payment gateway not configured. Contact support." }
  }

  const amountStr = formatMoolreAmount(amount)
  if (!amountStr) {
    return { ok: false, error: "Invalid payment amount." }
  }

  const billingEmail = billingEmailFromPhone(String(email || "").split("@")[0]) || String(email || "").trim()
  const webhookUrl = resolveMoolreWebhookUrl()
  const redirectUrl = redirectOverride
    ? String(redirectOverride).trim().replace(/[?#].*$/, "")
    : resolveMoolreRedirectUrl()
  const safeMetadata = stringifyMetadata(metadata)

  const payload = {
    type: 1,
    amount: amountStr,
    email: billingEmail,
    externalref,
    callback: webhookUrl,
    redirect: redirectUrl,
    reusable: "0",
    expiration_time: 15,
    currency: "GHS",
    accountnumber: MOOLRE_ACCOUNT_NUMBER,
    metadata: safeMetadata,
  }

  console.log("[moolre-init] embed/link request", {
    externalref,
    amount: amountStr,
    email: maskEmail(billingEmail),
    webhookUrl,
    redirectUrl,
    metadataKeys: Object.keys(safeMetadata),
  })
  buyLog("moolre embed request", {
    externalref,
    amount: amountStr,
    email: maskEmail(billingEmail),
    webhookUrl,
    redirectUrl,
    metadata: safeMetadata,
  })

  const posted = await postMoolreEmbedLink(payload, externalref)
  if (posted.ok) {
    return { ok: true, authorization_url: posted.authorization_url, redirect_url: redirectUrl }
  }

  const code = String(posted.code || "").toUpperCase()
  if (code === "IE01" || /internal error/i.test(posted.error)) {
    buyError("moolre embed busy", { externalref, code, error: posted.error })
    return {
      ok: false,
      error:
        "MoMo checkout is still opening from a previous try. Wait about a minute, then tap Pay once. Do not tap Pay repeatedly.",
    }
  }

  return { ok: false, error: posted.error }
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} externalref
 * @returns {Promise<{ ok: true, authorization_url: string } | { ok: false, error: string, code?: string }>}
 */
async function postMoolreEmbedLink(payload, externalref) {
  const response = await fetch(MOOLRE_EMBED_URL, {
    method: "POST",
    headers: {
      ...getMoolrePaymentAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  /** @type {Record<string, unknown> | null} */
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    console.error("[moolre-init] invalid JSON response", {
      externalref,
      httpStatus: response.status,
      bodyPreview: text.slice(0, 400),
    })
    buyError("moolre embed invalid JSON", {
      externalref,
      httpStatus: response.status,
      bodyPreview: text.slice(0, 400),
    })
    return { ok: false, error: "Invalid response from payment gateway." }
  }

  const status = Number(data?.status)
  const code = data && typeof data.code === "string" ? data.code : ""
  console.log("[moolre-init] embed/link response", {
    externalref,
    httpStatus: response.status,
    moolreStatus: status,
    code,
    message: data?.message,
    hasAuthUrl: Boolean(data?.data && typeof data.data === "object"),
  })
  buyLog("moolre embed response", {
    externalref,
    httpStatus: response.status,
    moolreStatus: status,
    code,
    body: data,
  })

  if (!response.ok || (status !== 1 && status !== 200)) {
    const msg =
      data && typeof data === "object" && "message" in data && data.message
        ? String(data.message)
        : "Payment initialization failed"
    console.error("[moolre-init] failed", { externalref, httpStatus: response.status, msg, code })
    buyError("moolre embed failed", { externalref, httpStatus: response.status, msg, body: data })
    return { ok: false, error: msg, code }
  }

  const authUrl =
    data?.data && typeof data.data === "object" && "authorization_url" in data.data
      ? String(/** @type {{ authorization_url?: string }} */ (data.data).authorization_url || "")
      : ""

  if (!authUrl) {
    return { ok: false, error: "Payment gateway did not return a payment URL." }
  }

  return { ok: true, authorization_url: authUrl }
}

/**
 * Poll Moolre status — handles delay between redirect and wallet debit.
 * @param {string} paymentReference
 */
export async function verifyMoolrePaymentWithRetry(paymentReference) {
  const delays = [0, 2000, 3000, 4000, 5000, 6000]
  let lastMessage = "Payment verification failed"

  console.log("[moolre-verify] start", { paymentReference, attempts: delays.length })
  buyLog("moolre verify start", { paymentReference, attempts: delays.length })

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]))
    }

    const status = await checkMoolrePaymentStatus(paymentReference)
    console.log("[moolre-verify] poll", {
      paymentReference,
      attempt: attempt + 1,
      ok: status.ok,
      isPaid: status.isPaid,
      txStatusNum: status.txStatusNum,
      message: status.message || status.error,
    })
    buyLog("moolre verify poll", {
      paymentReference,
      attempt: attempt + 1,
      ok: status.ok,
      isPaid: status.isPaid,
      txStatusNum: status.txStatusNum,
      code: status.code,
      message: status.message || status.error,
      data: status.data,
    })

    if (!status.ok) {
      lastMessage = status.error || status.message || lastMessage
      break
    }

    if (status.isPaid) {
      const amountPaid = Number(status.data?.amount ?? status.data?.Amount ?? 0)
      console.log("[moolre-verify] paid", { paymentReference, amountPaid })
      buyLog("moolre verify paid", { paymentReference, amountPaid, data: status.data })
      return { ok: true, amountPaid, data: status.data }
    }

    if (status.txStatusNum === 2) {
      console.warn("[moolre-verify] failed/cancelled", { paymentReference })
      buyError("moolre verify failed or cancelled", { paymentReference, data: status.data })
      return { ok: false, error: "Payment failed or was cancelled." }
    }

    lastMessage = "Payment is still processing. Please wait and try again."
  }

  console.warn("[moolre-verify] exhausted retries", { paymentReference, lastMessage })
  buyError("moolre verify exhausted", { paymentReference, lastMessage })
  return { ok: false, error: lastMessage }
}

/**
 * @param {string} email
 */
function maskEmail(email) {
  const s = String(email || "")
  const at = s.indexOf("@")
  if (at <= 1) return "***"
  return `${s.slice(0, 2)}***${s.slice(at)}`
}
