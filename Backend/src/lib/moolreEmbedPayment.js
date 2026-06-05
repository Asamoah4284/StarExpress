import { randomUUID } from "node:crypto"
import { checkMoolrePaymentStatus } from "./moolrePaymentStatus.js"
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

  const backendUrl = process.env.BACKEND_URL || process.env.API_URL || "http://127.0.0.1:4000"
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173"
  const webhookUrl = `${backendUrl.replace(/\/$/, "")}/api/moolre/callback`
  const redirectUrl = `${frontendUrl.replace(/\/$/, "")}/agent-payment-success`

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
    return { ok: false, error: "Invalid response from payment gateway." }
  }

  const status = Number(data?.status)
  if (!response.ok || (status !== 1 && status !== 200)) {
    const msg =
      data && typeof data === "object" && "message" in data && data.message
        ? String(data.message)
        : "Payment initialization failed"
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
  const delays = [0, 2000, 3000, 4000]
  let lastMessage = "Payment verification failed"

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]))
    }

    const status = await checkMoolrePaymentStatus(paymentReference)
    if (!status.ok) {
      lastMessage = status.error || status.message || lastMessage
      break
    }

    if (status.isPaid) {
      const amountPaid = Number(status.data?.amount ?? status.data?.Amount ?? 0)
      return { ok: true, amountPaid, data: status.data }
    }

    if (status.txStatusNum === 2) {
      return { ok: false, error: "Payment failed or was cancelled." }
    }

    lastMessage = "Payment is still processing. Please wait and try again."
  }

  return { ok: false, error: lastMessage }
}
