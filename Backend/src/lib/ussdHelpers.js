import crypto from "node:crypto"

const MOOLRE_USERNAME = process.env.MOOLRE_USERNAME
const MOOLRE_PUBLIC_KEY = process.env.MOOLRE_PUBLIC_KEY
const MOOLRE_ACCOUNT_NUMBER = process.env.MOOLRE_ACCOUNT_NUMBER
const MOOLRE_WEBHOOK_SECRET = process.env.MOOLRE_WEBHOOK_SECRET
const BACKEND_URL =
  process.env.BACKEND_URL || process.env.API_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:4000"

export const USSD_SHORTCODE = process.env.USSD_SHORTCODE || "*203*419#"

/**
 * @param {string | null | undefined} msisdn
 */
export function formatPhoneNumber(msisdn) {
  if (!msisdn) return null
  let cleaned = String(msisdn).replace(/\D/g, "")
  if (cleaned.startsWith("0")) cleaned = `233${cleaned.slice(1)}`
  else if (!cleaned.startsWith("233") && cleaned.length === 9) cleaned = `233${cleaned}`
  return cleaned
}

/**
 * @param {string} sessionId
 */
export function generatePaymentReference(sessionId) {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = crypto.randomBytes(4).toString("hex").toUpperCase()
  const sid = String(sessionId || "").slice(0, 8)
  return `SE-USSD-${sid}-${timestamp}-${random}`
}

/**
 * @param {string | null | undefined} msisdn
 */
export function getNetworkFromMsisdn(msisdn) {
  const phone = formatPhoneNumber(msisdn)
  if (!phone) return "Unknown"
  const prefix = phone.slice(3, 5)
  if (["24", "54", "55", "59"].includes(prefix)) return "MTN"
  if (["20", "50"].includes(prefix)) return "Vodafone"
  if (["26", "27", "56", "57"].includes(prefix)) return "Telecel"
  return "Unknown"
}

/**
 * @param {string} network
 */
function getMoolreChannelForNetwork(network) {
  const n = (network || "").trim()
  if (n === "MTN") return process.env.MOOLRE_CHANNEL_MTN || "13"
  if (n === "Vodafone") return process.env.MOOLRE_CHANNEL_VODAFONE || process.env.MOOLRE_DIRECT_DEBIT_CHANNEL || "15"
  if (n === "Telecel" || n === "AirtelTigo" || n === "AT") {
    return process.env.MOOLRE_CHANNEL_TELECEL || process.env.MOOLRE_DIRECT_DEBIT_CHANNEL || "14"
  }
  return process.env.MOOLRE_DIRECT_DEBIT_CHANNEL || "13"
}

/**
 * @param {unknown} body
 */
export function normalizeUssdPayload(body) {
  if (!body || typeof body !== "object") return {}
  return {
    sessionId: body.sessionId || body.session_id || body.SessionId || body.sessionID || null,
    isNewSession: body.new !== undefined ? body.new : body.isNew,
    msisdn: body.msisdn || body.MSISDN || body.phone || body.Phone || body.mobile || body.Mobile || null,
    network: body.network ?? body.Network ?? null,
    userInput: body.message ?? body.Message ?? body.text ?? body.input ?? "",
    extension: body.extension || body.Extension || null,
    data: body.data || body.Data || {},
  }
}

/**
 * @param {import("express").Request} req
 */
export function getUssdPayload(req) {
  let raw = req.body
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = {}
    }
  }
  if (!raw || typeof raw !== "object") raw = {}

  const keys = Object.keys(raw)
  if (keys.length === 1) {
    const key = keys[0]
    if (key.trim().startsWith("{")) {
      try {
        const cleanJson = key.replace(/\\r\\n/g, "").replace(/\r\n/g, "")
        raw = JSON.parse(cleanJson)
      } catch {
        /* keep raw */
      }
    }
  }

  const query = req.query || {}
  if (Object.keys(query).length > 0) raw = { ...query, ...raw }

  const nested = raw.data || raw.payload || raw.request || raw.body
  return typeof nested === "object" && nested !== null ? nested : raw
}

/**
 * @param {string | number | null | undefined} rawNetwork
 * @param {string} msisdn
 */
export function normalizeNetworkName(rawNetwork, msisdn) {
  if (rawNetwork != null) {
    const n = Number(rawNetwork)
    if (n === 3) return "MTN"
    if (n === 5) return "AT"
    if (n === 6) return "Telecel"
  }
  const fromMsisdn = getNetworkFromMsisdn(msisdn)
  if (fromMsisdn && fromMsisdn !== "Unknown") return fromMsisdn
  if (rawNetwork != null) {
    const s = String(rawNetwork).trim().toUpperCase()
    if (s === "MTN") return "MTN"
    if (s === "VODAFONE") return "Vodafone"
    if (s === "AT" || s === "AIRTELTIGO") return "AT"
    if (s === "TELECEL") return "Telecel"
  }
  return fromMsisdn || "Unknown"
}

/**
 * @param {unknown} payload
 * @param {import("express").Request["headers"]} headers
 */
export function verifyMoolreWebhook(payload, headers = {}) {
  const h = headers || {}
  const p = payload && typeof payload === "object" ? payload : {}
  const webhookSecret =
    p?.data?.secret ??
    p?.secret ??
    p?.data?.webhookSecret ??
    h["x-moolre-secret"] ??
    h["x-moolre-webhook-secret"] ??
    h["x-webhook-secret"] ??
    null

  if (MOOLRE_WEBHOOK_SECRET) {
    if (!webhookSecret) {
      return String(process.env.MOOLRE_WEBHOOK_ALLOW_MISSING_SECRET || "").toLowerCase() === "true"
    }
    return webhookSecret === MOOLRE_WEBHOOK_SECRET
  }
  return true
}

/**
 * Fire-and-forget MoMo direct debit (USSD must end session before PIN prompt).
 * @param {string} msisdn
 * @param {number} amount
 * @param {string} sessionId
 * @param {{ packageName?: string, description?: string, reference?: string, network?: string, moolreNetwork?: number | null }} options
 */
export async function initiateMoMoPayment(msisdn, amount, sessionId, options = {}) {
  const {
    packageName = "WiFi package",
    description = "StarExpress WiFi voucher",
    reference: preGeneratedReference = null,
    network: networkHint = null,
    moolreNetwork: moolreNetworkCode = null,
  } = options

  const formattedPhone = formatPhoneNumber(msisdn)
  const reference = preGeneratedReference || generatePaymentReference(sessionId)

  const getPaymentChannel = (/** @type {number | null} */ moolreNet) => {
    if (moolreNet === 3) return "13"
    if (moolreNet === 5) return "5"
    if (moolreNet === 6) return "6"
    return null
  }

  const paymentChannelFromMoolre = getPaymentChannel(moolreNetworkCode ?? null)
  const channel =
    paymentChannelFromMoolre || getMoolreChannelForNetwork(networkHint || getNetworkFromMsisdn(msisdn))

  const baseUrl = BACKEND_URL.replace(/\/$/, "")
  const webhookUrl = `${baseUrl}/ussd/payments/webhook`

  if (!MOOLRE_USERNAME || !MOOLRE_PUBLIC_KEY || !MOOLRE_ACCOUNT_NUMBER) {
    console.warn("[ussd-momo] Moolre credentials not set; mock payment for", reference)
    return {
      success: true,
      reference,
      message: "Payment prompt sent to your phone",
      provider: "moolre",
      mock: true,
    }
  }

  const authHeaders = {
    "X-API-USER": MOOLRE_USERNAME,
    "X-API-PUBKEY": MOOLRE_PUBLIC_KEY,
    "Content-Type": "application/json",
  }

  const parseJsonResponse = (/** @type {Response} */ res, /** @type {string} */ text) => {
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      console.warn("[ussd-momo] Non-JSON response", res.status, text.slice(0, 120))
      return null
    }
  }

  try {
    const payerPhone = formattedPhone?.startsWith("233") ? `0${formattedPhone.slice(3)}` : formattedPhone
    const includeCallback =
      String(process.env.MOOLRE_DIRECT_DEBIT_INCLUDE_CALLBACK || "").toLowerCase() === "true"
    /** @type {Record<string, string>} */
    const directDebitPayload = {
      type: "1",
      channel: String(channel),
      currency: "GHS",
      payer: payerPhone || "",
      amount: String(amount),
      externalref: reference,
      otpcode: "",
      reference: "",
      sessionid: sessionId || "",
      accountnumber: MOOLRE_ACCOUNT_NUMBER,
    }
    if (includeCallback) {
      directDebitPayload.callback = webhookUrl
      directDebitPayload.redirect = webhookUrl
    }

    console.log("[ussd-momo] POST payment", { reference, amount, channel, packageName })

    let response = await fetch("https://api.moolre.com/open/transact/payment", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(directDebitPayload),
    })
    let responseText = await response.text()
    let data = parseJsonResponse(response, responseText)

    if (response.ok && data && (data.status === 1 || data.status === 200)) {
      return {
        success: true,
        reference,
        provider: "moolre",
        action: "PROMPT_TRIGGERED",
        message: "Payment prompt sent. Enter your MoMo PIN to approve.",
        data: data.data || data,
      }
    }

    console.warn("[ussd-momo] Direct debit failed, trying embed/link")
    const moolreData = {
      type: 1,
      amount: String(amount),
      email: `${formattedPhone}@ussd.starexpress.local`,
      phone: formattedPhone,
      externalref: reference,
      callback: webhookUrl,
      redirect: webhookUrl,
      reusable: "0",
      currency: "GHS",
      accountnumber: MOOLRE_ACCOUNT_NUMBER,
      metadata: { sessionId, packageName, channel: "ussd", description },
    }

    response = await fetch("https://api.moolre.com/embed/link", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(moolreData),
    })
    responseText = await response.text()
    data = parseJsonResponse(response, responseText)

    if (!response.ok || !data || (data.status !== 1 && data.status !== 200)) {
      return {
        success: false,
        reference,
        message: data?.message || "Payment initiation failed",
        provider: "moolre",
      }
    }

    return {
      success: true,
      reference,
      provider: "moolre",
      action: "LINK_GENERATED",
      message: "Payment link generated",
      data: data.data || {},
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[ussd-momo] Error:", msg)
    return { success: false, reference, message: msg, provider: "moolre" }
  }
}
