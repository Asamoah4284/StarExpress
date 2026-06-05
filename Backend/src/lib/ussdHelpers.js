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
 * @param {string} sessionId
 */
export function generateAgentPaymentReference(sessionId) {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = crypto.randomBytes(4).toString("hex").toUpperCase()
  const sid = String(sessionId || "").slice(0, 8)
  return `SE-AGENT-${sid}-${timestamp}-${random}`
}

export function getMoolrePaymentAuthHeaders() {
  return {
    "X-API-USER": MOOLRE_USERNAME || "",
    "X-API-PUBKEY": MOOLRE_PUBLIC_KEY || "",
    "Content-Type": "application/json",
  }
}

/**
 * @param {string | null | undefined} msisdn
 */
/**
 * Ghana MoMo network from MSISDN prefix.
 * 020/050 are Telecel (formerly Vodafone Ghana) — Moolre API uses channel 6, not Vodafone 15.
 * @param {string | null | undefined} msisdn
 */
export function getNetworkFromMsisdn(msisdn) {
  const phone = formatPhoneNumber(msisdn)
  if (!phone) return "Unknown"
  const prefix = phone.slice(3, 5)
  if (["24", "25", "53", "54", "55", "59"].includes(prefix)) return "MTN"
  if (["20", "50"].includes(prefix)) return "Telecel"
  if (["26", "27", "56", "57"].includes(prefix)) return "AT"
  return "Unknown"
}

/**
 * @param {string | null | undefined} raw
 */
export function normalizePaymentNetworkChoice(raw) {
  const s = String(raw || "").trim()
  if (!s || s.toLowerCase() === "auto") return null
  if (s === "MTN") return "MTN"
  if (s === "Telecel" || s === "Vodafone") return "Telecel"
  if (s === "AT" || s === "AirtelTigo") return "AT"
  return null
}

/**
 * @param {string | null | undefined} msisdn
 * @param {string | null | undefined} [networkOverride]
 */
export function resolvePaymentNetwork(msisdn, networkOverride) {
  const chosen = normalizePaymentNetworkChoice(networkOverride)
  if (chosen) return chosen
  const detected = getNetworkFromMsisdn(msisdn)
  return detected === "Unknown" ? "MTN" : detected
}

/**
 * Moolre payment API channels (docs.moolre.com): 13=MTN, 6=Telecel, 7=AT.
 * USSD gateway sends network: 3=MTN, 5=AT, 6=Telecel — map to payment channels.
 * @param {number | null | undefined} moolreUssdNetwork
 */
export function mapUssdNetworkToPaymentChannel(moolreUssdNetwork) {
  const n = Number(moolreUssdNetwork)
  if (n === 3) return String(process.env.MOOLRE_CHANNEL_MTN || "13")
  if (n === 5) return String(process.env.MOOLRE_CHANNEL_AT || "7")
  if (n === 6) return String(process.env.MOOLRE_CHANNEL_TELECEL || "6")
  return null
}

/**
 * Moolre direct-debit channels: 13=MTN, 6=Telecel, 7=AT (per docs.moolre.com).
 * Channel 15 (legacy Vodafone) does not support API top-up (TP09).
 * @param {string} network
 */
export function getMoolreChannelForNetwork(network) {
  const n = (network || "").trim()
  if (n === "MTN") return String(process.env.MOOLRE_CHANNEL_MTN || "13")
  if (n === "Telecel" || n === "Vodafone") return String(process.env.MOOLRE_CHANNEL_TELECEL || "6")
  if (n === "AT" || n === "AirtelTigo") return String(process.env.MOOLRE_CHANNEL_AT || "7")
  return String(process.env.MOOLRE_DIRECT_DEBIT_CHANNEL || process.env.MOOLRE_CHANNEL_MTN || "13")
}

/**
 * @param {unknown} data
 */
function isMoolreApiSuccess(data) {
  if (!data || typeof data !== "object") return false
  const status = Number(/** @type {{ status?: unknown }} */ (data).status)
  return status === 1 || status === 200
}

export function getMoolrePaymentCallbackUrl() {
  const explicit = String(process.env.MOOLRE_PAYMENT_CALLBACK_URL || "").trim()
  if (explicit) {
    return explicit.replace(/([^:]\/)\/+/g, "$1").replace(/\/$/, "")
  }
  const base = BACKEND_URL.replace(/\/$/, "")
  const joined = `${base}/api/moolre/callback`
  return joined.replace(/([^:]\/)\/+/g, "$1")
}

function shouldIncludePaymentCallbackInRequest() {
  if (String(process.env.MOOLRE_DIRECT_DEBIT_INCLUDE_CALLBACK || "").toLowerCase() === "true") {
    return true
  }
  if (process.env.MOOLRE_PAYMENT_CALLBACK_URL) return true
  const base = BACKEND_URL.replace(/\/$/, "")
  return base.startsWith("https://") && !base.includes("localhost")
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
 * @param {{
 *   packageName?: string
 *   description?: string
 *   reference?: string
 *   network?: string
 *   moolreNetwork?: number | null
 *   otpcode?: string
 *   networkOverride?: string
 *   moolreTransactionId?: string | null
 *   includeCallback?: boolean
 *   paymentPhase?: string
 * }} options
 */
const MOOLRE_PAYMENT_URL = "https://api.moolre.com/open/transact/payment"

/**
 * @param {Record<string, unknown>} payload
 * @param {Record<string, string>} authHeaders
 */
async function postMoolrePayment(payload, authHeaders) {
  const response = await fetch(MOOLRE_PAYMENT_URL, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(payload),
  })
  const responseText = await response.text()
  let data = null
  try {
    data = responseText ? JSON.parse(responseText) : null
  } catch {
    console.warn("[ussd-momo] Non-JSON response", response.status, responseText?.slice(0, 400))
  }
  return { response, data, responseText }
}

/**
 * Moolre returns a transaction UUID in `data` on TR099; may also appear after TP17.
 * @param {unknown} apiData
 */
export function extractMoolreTransactionId(apiData) {
  if (!apiData || typeof apiData !== "object") return null
  const raw = /** @type {{ data?: unknown }} */ (apiData).data
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (trimmed && trimmed.toLowerCase() !== "all") return trimmed
  }
  if (raw && typeof raw === "object" && raw !== null) {
    const id = /** @type {{ id?: unknown, transactionid?: unknown }} */ (raw).id
    if (typeof id === "string" && id.trim()) return id.trim()
    const txn = /** @type {{ transactionid?: unknown }} */ (raw).transactionid
    if (typeof txn === "string" && txn.trim()) return txn.trim()
  }
  return null
}

/**
 * Build Moolre /open/transact/payment body.
 * Do NOT send empty `reference` or `otpcode` — Moolre's PHP layer throws SQLSTATE[HY093] on follow-up calls.
 * @param {{
 *   channel: string
 *   payerPhone: string
 *   amount: number
 *   externalref: string
 *   sessionId: string
 *   otpcode?: string
 *   moolreTransactionId?: string | null
 *   includeCallback?: boolean
 * }} params
 */
function buildMoolreDirectDebitPayload(params) {
  const callbackUrl = getMoolrePaymentCallbackUrl()
  /** @type {Record<string, unknown>} */
  const payload = {
    type: 1,
    channel: String(params.channel),
    currency: "GHS",
    payer: params.payerPhone || "",
    amount: String(params.amount),
    externalref: params.externalref,
    sessionid: String(params.sessionId || ""),
    accountnumber: MOOLRE_ACCOUNT_NUMBER,
  }

  const otp = typeof params.otpcode === "string" ? params.otpcode.trim() : ""
  if (otp) payload.otpcode = otp

  const moolreRef =
    typeof params.moolreTransactionId === "string" ? params.moolreTransactionId.trim() : ""
  if (moolreRef) payload.reference = moolreRef

  if (params.includeCallback !== false) {
    payload.callback = callbackUrl
    payload.redirect = callbackUrl
  }

  return payload
}

/**
 * @param {unknown} data
 * @param {string} responseText
 */
function moolreFailureMessage(data, responseText) {
  if (data && typeof data === "object" && "message" in data && data.message) {
    return String(data.message)
  }
  if (responseText && /PDOException|SQLSTATE/i.test(responseText)) {
    return "Moolre payment service error. Retry in a moment or contact Moolre support if this persists."
  }
  return "Payment initiation failed"
}

export async function initiateMoMoPayment(msisdn, amount, sessionId, options = {}) {
  const {
    packageName = "WiFi package",
    reference: preGeneratedReference = null,
    network: networkHint = null,
    moolreNetwork: moolreNetworkCode = null,
    otpcode = undefined,
    networkOverride = null,
    moolreTransactionId = null,
    includeCallback = true,
    paymentPhase = "initial",
  } = options

  const formattedPhone = formatPhoneNumber(msisdn)
  const reference = preGeneratedReference || generatePaymentReference(sessionId)

  const resolvedNetwork = resolvePaymentNetwork(msisdn, networkOverride || networkHint)
  const paymentChannelFromUssd = mapUssdNetworkToPaymentChannel(moolreNetworkCode ?? null)
  const channel = paymentChannelFromUssd || getMoolreChannelForNetwork(resolvedNetwork)

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

  try {
    const payerPhone = formattedPhone?.startsWith("233") ? `0${formattedPhone.slice(3)}` : formattedPhone
    const otpValue = typeof otpcode === "string" ? otpcode.trim() : ""

    const directDebitPayload = buildMoolreDirectDebitPayload({
      channel,
      payerPhone: payerPhone || "",
      amount,
      externalref: reference,
      sessionId,
      otpcode: otpValue || undefined,
      moolreTransactionId,
      includeCallback,
    })

    console.log("[ussd-momo] POST payment", {
      phase: paymentPhase,
      externalref: reference,
      amount,
      channel,
      network: resolvedNetwork,
      moolreUssdNetwork: moolreNetworkCode,
      payer: payerPhone,
      packageName,
      otpcode: otpValue ? "(set)" : "(omitted)",
      moolreTransactionId: moolreTransactionId || "(omitted)",
      includeCallback,
    })

    const { response, data, responseText } = await postMoolrePayment(directDebitPayload, authHeaders)
    const parsedTxnId = extractMoolreTransactionId(data)

    if (!response.ok || !isMoolreApiSuccess(data)) {
      const code = data && typeof data === "object" ? String(data.code || "").toUpperCase() : ""
      const apiMessage = moolreFailureMessage(data, responseText)
      console.error("[ussd-momo] payment failed", paymentPhase, response.status, data || responseText?.slice(0, 400))
      let message = apiMessage
      if (code === "TP09") {
        message = `${apiMessage} Try selecting the correct network (MTN, Telecel, or AT) for this number. Used channel ${channel} (${resolvedNetwork}).`
      }
      return {
        success: false,
        reference,
        message,
        provider: "moolre",
        moolreCode: code || undefined,
        channel,
        network: resolvedNetwork,
        moolreTransactionId: parsedTxnId,
      }
    }

    const code = String(data?.code || "").toUpperCase()
    const txnId = parsedTxnId || extractMoolreTransactionId(data)
    console.log("[ussd-momo] payment OK", { phase: paymentPhase, code, message: data?.message, moolreTransactionId: txnId })

    // TP14 = Moolre sent an SMS verification PIN to the payer; submit otpcode on the next request.
    if (code === "TP14") {
      return {
        success: true,
        reference,
        action: "OTP_REQUIRED",
        message: "A verification PIN was sent to the customer's phone via SMS.",
        provider: "moolre",
        moolreCode: code,
        channel,
        network: resolvedNetwork,
        moolreTransactionId: txnId,
        data: data?.data,
      }
    }

    // TP17 = SMS OTP accepted; post again with same externalref, no otpcode, optional Moolre transaction id.
    if (code === "TP17") {
      return {
        success: true,
        reference,
        action: "OTP_VERIFIED",
        message: "Phone verified. Triggering MoMo payment prompt…",
        provider: "moolre",
        moolreCode: code,
        channel,
        network: resolvedNetwork,
        moolreTransactionId: txnId,
        data: data?.data,
      }
    }

    // TR099 = MoMo PIN prompt sent to payer phone.
    if (code === "TR099") {
      console.log("[ussd-momo] TR099 — MoMo prompt should appear on payer phone", {
        reference,
        channel,
        network: resolvedNetwork,
        moolreTransactionId: txnId,
      })
      return {
        success: true,
        reference,
        provider: "moolre",
        action: "PROMPT_TRIGGERED",
        message: "Payment prompt sent. Enter your MoMo PIN to approve.",
        data: data?.data || data,
        moolreCode: code,
        channel,
        network: resolvedNetwork,
        moolreTransactionId: txnId,
      }
    }

    return {
      success: false,
      reference,
      provider: "moolre",
      message:
        (data && typeof data === "object" && "message" in data && String(data.message)) ||
        `Unexpected Moolre payment response (${code || "unknown"}).`,
      moolreCode: code,
      channel,
      network: resolvedNetwork,
      moolreTransactionId: txnId,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[ussd-momo] Error:", msg)
    return { success: false, reference, message: msg, provider: "moolre" }
  }
}

function momoPromptDelayMs() {
  return Number(process.env.AGENT_MOMO_START_DELAY_MS || process.env.USSD_MOMO_START_DELAY_MS) || 1500
}

/**
 * Agent flow: submit SMS OTP, then if Moolre returns TP17 post again (same ref, no otp) for TR099 MoMo prompt.
 * @param {string} msisdn
 * @param {number} amount
 * @param {string} sessionId
 * @param {{ packageName?: string, reference: string, network?: string, networkOverride?: string, otpcode: string, moolreTransactionId?: string | null }} options
 */
export async function submitMoMoPaymentWithOtp(msisdn, amount, sessionId, options) {
  const otpResult = await initiateMoMoPayment(msisdn, amount, sessionId, {
    packageName: options.packageName,
    reference: options.reference,
    network: options.network,
    networkOverride: options.networkOverride,
    otpcode: options.otpcode,
    moolreTransactionId: options.moolreTransactionId || null,
    includeCallback: true,
    paymentPhase: "otp",
  })

  if (otpResult.moolreCode === "TR099" || otpResult.action === "PROMPT_TRIGGERED") {
    return otpResult
  }
  if (otpResult.moolreCode !== "TP17" && otpResult.action !== "OTP_VERIFIED") {
    return otpResult
  }

  const delayMs = momoPromptDelayMs()
  const moolreTxnId = otpResult.moolreTransactionId || options.moolreTransactionId || null
  console.log("[ussd-momo] TP17 verified — triggering MoMo debit after", delayMs, "ms", {
    externalref: options.reference,
    moolreTransactionId: moolreTxnId || "(none)",
  })
  await new Promise((resolve) => setTimeout(resolve, delayMs))

  const debitResult = await initiateMoMoPayment(msisdn, amount, sessionId, {
    packageName: options.packageName,
    reference: options.reference,
    network: options.network,
    networkOverride: options.networkOverride,
    moolreTransactionId: moolreTxnId,
    includeCallback: false,
    paymentPhase: "debit",
  })

  if (debitResult.moolreCode === "TR099" || debitResult.action === "PROMPT_TRIGGERED") {
    return debitResult
  }

  if (!debitResult.success && !moolreTxnId) {
    console.log("[ussd-momo] debit without txn id failed — retrying with callback included")
    const retryResult = await initiateMoMoPayment(msisdn, amount, sessionId, {
      packageName: options.packageName,
      reference: options.reference,
      network: options.network,
      networkOverride: options.networkOverride,
      includeCallback: true,
      paymentPhase: "debit-retry",
    })
    if (retryResult.moolreCode === "TR099" || retryResult.action === "PROMPT_TRIGGERED") {
      return retryResult
    }
  }

  return {
    ...debitResult,
    success: false,
    message:
      debitResult.message ||
      "Phone was verified but the MoMo payment prompt could not be sent. Ask the customer to check their phone or try again.",
  }
}
