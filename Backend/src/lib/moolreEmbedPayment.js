import { randomUUID } from "node:crypto"
import { checkMoolrePaymentStatus } from "./moolrePaymentStatus.js"
import { resolveMoolreRedirectUrl, resolveMoolreWebhookUrl } from "./moolrePaymentUrls.js"
import { getMoolrePaymentAuthHeaders } from "./ussdHelpers.js"

const MOOLRE_ACCOUNT_NUMBER = process.env.MOOLRE_ACCOUNT_NUMBER
const MOOLRE_EMBED_URL = "https://api.moolre.com/embed/link"

/**
 * @param {string} phone
 */
export function billingEmailFromPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "")
  if (digits.length < 7) return null
  return `${digits}@phone.starexpress.app`
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
 * }} opts
 */
export async function initializeMoolreEmbedLink(opts) {
  const { amount, email, externalref, metadata = {} } = opts

  if (!MOOLRE_ACCOUNT_NUMBER || !process.env.MOOLRE_USERNAME || !process.env.MOOLRE_PUBLIC_KEY) {
    return { ok: false, error: "Payment gateway not configured. Contact support." }
  }

  const webhookUrl = resolveMoolreWebhookUrl()
  const redirectBase = resolveMoolreRedirectUrl()
  const redirectUrl = `${redirectBase}${redirectBase.includes("?") ? "&" : "?"}externalref=${encodeURIComponent(externalref)}`

  console.log("[moolre-init] embed/link request", {
    externalref,
    amount,
    email: maskEmail(email),
    webhookUrl,
    redirectUrl,
    metadataKeys: Object.keys(metadata),
  })

  const payload = {
    type: 1,
    amount: String(amount),
    email,
    externalref,
    callback: webhookUrl,
    redirect: redirectUrl,
    reusable: "0",
    currency: "GHS",
    accountnumber: MOOLRE_ACCOUNT_NUMBER,
    metadata,
  }

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
    return { ok: false, error: "Invalid response from payment gateway." }
  }

  const status = Number(data?.status)
  console.log("[moolre-init] embed/link response", {
    externalref,
    httpStatus: response.status,
    moolreStatus: status,
    message: data?.message,
    hasAuthUrl: Boolean(data?.data && typeof data.data === "object"),
  })

  if (!response.ok || (status !== 1 && status !== 200)) {
    const msg =
      data && typeof data === "object" && "message" in data && data.message
        ? String(data.message)
        : "Payment initialization failed"
    console.error("[moolre-init] failed", { externalref, httpStatus: response.status, msg })
    return { ok: false, error: msg }
  }

  const authUrl =
    data?.data && typeof data.data === "object" && "authorization_url" in data.data
      ? String(/** @type {{ authorization_url?: string }} */ (data.data).authorization_url || "")
      : ""

  if (!authUrl) {
    return { ok: false, error: "Payment gateway did not return a payment URL." }
  }

  return { ok: true, authorization_url: authUrl, redirect_url: redirectUrl }
}

/**
 * Poll Moolre status — handles delay between redirect and wallet debit.
 * @param {string} paymentReference
 */
export async function verifyMoolrePaymentWithRetry(paymentReference) {
  const delays = [0, 2000, 3000, 4000, 5000, 6000]
  let lastMessage = "Payment verification failed"

  console.log("[moolre-verify] start", { paymentReference, attempts: delays.length })

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

    if (!status.ok) {
      lastMessage = status.error || status.message || lastMessage
      break
    }

    if (status.isPaid) {
      const amountPaid = Number(status.data?.amount ?? status.data?.Amount ?? 0)
      console.log("[moolre-verify] paid", { paymentReference, amountPaid })
      return { ok: true, amountPaid, data: status.data }
    }

    if (status.txStatusNum === 2) {
      console.warn("[moolre-verify] failed/cancelled", { paymentReference })
      return { ok: false, error: "Payment failed or was cancelled." }
    }

    lastMessage = "Payment is still processing. Please wait and try again."
  }

  console.warn("[moolre-verify] exhausted retries", { paymentReference, lastMessage })
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
