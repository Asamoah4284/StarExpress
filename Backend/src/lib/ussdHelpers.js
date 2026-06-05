import crypto from "node:crypto"

const MOOLRE_USERNAME = process.env.MOOLRE_USERNAME
const MOOLRE_PUBLIC_KEY = process.env.MOOLRE_PUBLIC_KEY
const MOOLRE_PRIVATE_KEY = process.env.MOOLRE_PRIVATE_KEY || process.env.MOOLRE_SECRET_KEY || ""
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

/**
 * Moolre requires a unique externalref per debit POST (TP13 if reused).
 * After TP17 verify on the agent ref, the PIN prompt uses a fresh debit ref.
 * @param {string} verifyReference
 */
export function generateMoolrePinPromptReference(verifyReference) {
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase()
  const base = String(verifyReference || "SE").slice(0, 40)
  return `${base}-P${suffix}`
}

/**
 * USSD gateway network codes for Moolre payment channel mapping (3=MTN, 5=AT, 6=Telecel).
 * @param {string | null | undefined} msisdn
 * @returns {3 | 5 | 6 | null}
 */
export function getMoolreUssdNetworkFromMsisdn(msisdn) {
  const network = getNetworkFromMsisdn(msisdn)
  if (network === "MTN") return 3
  if (network === "AT" || network === "AirtelTigo") return 5
  if (network === "Telecel" || network === "Vodafone") return 6
  return null
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
 * @param {string} network
 */
function getMoolreChannelForNetwork(network) {
  const n = (network || "").trim()
  if (n === "MTN") return String(process.env.MOOLRE_CHANNEL_MTN || "13")
  if (n === "Telecel") return String(process.env.MOOLRE_CHANNEL_TELECEL || "6")
  if (n === "AT" || n === "AirtelTigo") return String(process.env.MOOLRE_CHANNEL_AT || "7")
  if (n === "Vodafone") return String(process.env.MOOLRE_CHANNEL_VODAFONE || "15")
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
  const raw = explicit || `${BACKEND_URL.replace(/\/$/, "")}/api/moolre/callback`
  return raw.replace(/([^:]\/)\/+/g, "$1").replace(/\/$/, "")
}

/** @returns {Record<string, string>} */
export function getMoolrePaymentAuthHeaders() {
  const headers = {
    "X-API-USER": MOOLRE_USERNAME || "",
    "Content-Type": "application/json",
  }
  if (MOOLRE_PRIVATE_KEY) {
    headers["X-API-KEY"] = MOOLRE_PRIVATE_KEY
  } else if (MOOLRE_PUBLIC_KEY) {
    headers["X-API-PUBKEY"] = MOOLRE_PUBLIC_KEY
  }
  return headers
}

function shouldIncludePaymentCallbackInRequest() {
  // Moolre direct debit: register webhook in dashboard only. Sending callback in the body
  // can break repeat posts (same externalref after TP17) — see As-market integration.
  return String(process.env.MOOLRE_DIRECT_DEBIT_INCLUDE_CALLBACK || "").toLowerCase() === "true"
}

/**
 * Moolre expects otpcode + reference on every direct-debit POST (use "" when unused).
 * @param {{
 *   channel: string
 *   payerPhone: string
 *   amount: number
 *   reference: string
 *   sessionId: string
 *   otp?: string
 * }} params
 */
function buildMoolreDirectDebitPayload({ channel, payerPhone, amount, reference, sessionId, otp = "" }) {
  /** @type {Record<string, unknown>} */
  const payload = {
    type: 1,
    channel: String(channel),
    currency: "GHS",
    payer: payerPhone || "",
    amount: String(amount),
    externalref: reference,
    otpcode: otp || "",
    reference: "",
    sessionid: String(sessionId || ""),
    accountnumber: MOOLRE_ACCOUNT_NUMBER,
  }
  if (shouldIncludePaymentCallbackInRequest()) {
    const callbackUrl = getMoolrePaymentCallbackUrl()
    payload.callback = callbackUrl
    payload.redirect = callbackUrl
  }
  return payload
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
 * @param {{ packageName?: string, description?: string, reference?: string, network?: string, moolreNetwork?: number | null, otpCode?: string }} options
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
    console.warn("[ussd-momo] Non-JSON response", response.status, responseText?.slice(0, 200))
  }
  return { response, data, responseText }
}

/** @param {number} ms */
async function sleepMs(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {Record<string, unknown>} payload
 * @param {Record<string, string>} authHeaders
 */
async function parseMoolrePaymentPost(payload, authHeaders) {
  const { response, data, responseText } = await postMoolrePayment(payload, authHeaders)
  if (!response.ok || !isMoolreApiSuccess(data)) {
    const raw = responseText?.slice(0, 300) || ""
    const duplicateRef =
      String(data && typeof data === "object" && "code" in data ? data.code : "").toUpperCase() === "TP13" ||
      /duplicate|must be unique/i.test(raw)
    return {
      ok: false,
      code: String(data && typeof data === "object" && "code" in data ? data.code : "").toUpperCase(),
      message:
        (data && typeof data === "object" && "message" in data && String(data.message)) ||
        (duplicateRef
          ? "Payment reference already used with Moolre."
          : /PDOException|HY093/i.test(raw)
            ? "Moolre payment service error (duplicate reference)."
            : "Payment initiation failed"),
      data: data?.data || data,
      httpStatus: response.status,
      raw,
      duplicateRef,
    }
  }
  return {
    ok: true,
    code: String(data?.code || "").toUpperCase(),
    message: typeof data?.message === "string" ? data.message : "",
    data: data?.data || data,
  }
}

/**
 * @param {string} reference
 * @param {{ ok: boolean, code: string, message?: string, data?: unknown }} parsed
 * @param {"OTP_REQUIRED" | "PIN_PROMPT_SENT"} action
 */
/**
 * @param {string} reference Agent/USSD session payment reference (stable for UI + sales).
 * @param {{ ok: boolean, code: string, message?: string, data?: unknown }} parsed
 * @param {"OTP_REQUIRED" | "PIN_PROMPT_SENT"} action
 * @param {{ moolreDebitReference?: string }} [extras]
 */
function moolrePaymentSuccess(reference, parsed, action, extras = {}) {
  return {
    success: true,
    reference,
    provider: "moolre",
    action,
    message:
      action === "OTP_REQUIRED"
        ? "Moolre sent a one-time verification SMS to the customer. Submit that code to trigger the MoMo PIN prompt."
        : "MoMo PIN prompt sent to the customer's phone.",
    data: parsed.data,
    moolreCode: parsed.code,
    ...extras,
  }
}

/**
 * @param {unknown} data
 * @returns {string | null}
 */
export function extractMoolreTransactionId(data) {
  if (data == null) return null
  if (typeof data === "string" && data.trim()) return data.trim()
  if (typeof data === "object" && !Array.isArray(data)) {
    const d = /** @type {Record<string, unknown>} */ (data)
    for (const key of ["transactionid", "transactionId", "id", "paymentid"]) {
      const v = d[key]
      if (v != null && String(v).trim()) return String(v).trim()
    }
  }
  return null
}

/**
 * Only poll Moolre after TR099 — the PIN prompt is registered with their API.
 * @param {{ success?: boolean, mock?: boolean, action?: string, moolreCode?: string }} momoResult
 */
export function shouldScheduleMoolrePaymentPoll(momoResult) {
  if (!momoResult?.success || momoResult.mock) return false
  if (momoResult.action === "OTP_REQUIRED") return false
  return String(momoResult.moolreCode || "").toUpperCase() === "TR099"
}

/**
 * @param {{ updateSession: (sessionId: string, patch: Record<string, unknown>) => Promise<unknown> }} sessionStore
 * @param {string} sessionId
 * @param {{ moolreCode?: string, data?: unknown }} momoResult
 */
export async function persistMoolreInitOnSession(sessionStore, sessionId, momoResult) {
  const moolreTransactionId = extractMoolreTransactionId(momoResult?.data)
  /** @type {Record<string, unknown>} */
  const patch = {}
  if (moolreTransactionId) patch.moolreTransactionId = moolreTransactionId
  if (momoResult?.moolreCode) patch.moolreInitCode = momoResult.moolreCode
  if (typeof momoResult?.moolreDebitReference === "string" && momoResult.moolreDebitReference.trim()) {
    patch.moolreDebitReference = momoResult.moolreDebitReference.trim()
  }
  if (Object.keys(patch).length > 0) {
    await sessionStore.updateSession(sessionId, patch)
  }
}

/**
 * After OTP verify (TP17), POST a fresh unique externalref with otpcode "" to trigger TR099.
 * @param {string} verifyReference Stable agent/USSD reference (TP14/TP17 steps).
 * @param {(otpValue?: string, externalRef?: string) => Record<string, unknown>} makePayload
 * @param {Record<string, string>} authHeaders
 * @param {string} channel
 */
async function triggerMoolrePinPrompt(verifyReference, makePayload, authHeaders, channel) {
  const pinDelayMs = Number(process.env.USSD_MOMO_START_DELAY_MS) || 1500
  const debitReference = generateMoolrePinPromptReference(verifyReference)
  console.log("[ussd-momo] triggering PIN prompt after verification", {
    verifyReference,
    debitReference,
    channel,
    pinDelayMs,
  })
  await sleepMs(pinDelayMs)

  const pinPayload = makePayload("", debitReference)

  console.log("[ussd-momo] POST payment (pin prompt)", {
    verifyReference,
    debitReference: pinPayload.externalref,
    amount: pinPayload.amount,
    channel: pinPayload.channel,
    payer: pinPayload.payer,
    hasOtp: false,
    hasCallback: "callback" in pinPayload,
  })

  const pinParsed = await parseMoolrePaymentPost(pinPayload, authHeaders)
  if (!pinParsed.ok) {
    console.error("[ussd-momo] PIN prompt failed", pinParsed.message, pinParsed.raw)
    return {
      success: false,
      reference: verifyReference,
      message: pinParsed.message || "Could not send MoMo PIN prompt after verification.",
      provider: "moolre",
      moolreCode: pinParsed.code || undefined,
      moolreDebitReference: debitReference,
    }
  }

  console.log("[ussd-momo] pin prompt response", { code: pinParsed.code, message: pinParsed.message })

  if (pinParsed.code === "TR099") {
    console.log("[ussd-momo] TR099 — MoMo PIN prompt sent", {
      verifyReference,
      debitReference,
      channel,
    })
    return moolrePaymentSuccess(verifyReference, pinParsed, "PIN_PROMPT_SENT", {
      moolreDebitReference: debitReference,
    })
  }

  if (pinParsed.code === "TP14") {
    return moolrePaymentSuccess(verifyReference, pinParsed, "OTP_REQUIRED")
  }

  return {
    success: false,
    reference: verifyReference,
    provider: "moolre",
    message: `Verification succeeded but Moolre did not send the PIN prompt (${pinParsed.code || "unknown"}).`,
    moolreCode: pinParsed.code,
    data: pinParsed.data,
    moolreDebitReference: debitReference,
  }
}

export async function initiateMoMoPayment(msisdn, amount, sessionId, options = {}) {
  const {
    packageName = "WiFi package",
    reference: preGeneratedReference = null,
    network: networkHint = null,
    moolreNetwork: moolreNetworkCode = null,
    otpCode = null,
  } = options

  const formattedPhone = formatPhoneNumber(msisdn)
  const reference = preGeneratedReference || generatePaymentReference(sessionId)

  const paymentChannelFromUssd = mapUssdNetworkToPaymentChannel(moolreNetworkCode ?? null)
  const channel =
    paymentChannelFromUssd || getMoolreChannelForNetwork(networkHint || getNetworkFromMsisdn(msisdn))

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

  const authHeaders = getMoolrePaymentAuthHeaders()

  try {
    const payerPhone = formattedPhone?.startsWith("233") ? `0${formattedPhone.slice(3)}` : formattedPhone
    const otp = typeof otpCode === "string" ? otpCode.trim() : ""

    const makePayload = (otpValue = "", externalRef = reference) =>
      buildMoolreDirectDebitPayload({
        channel,
        payerPhone,
        amount,
        reference: externalRef,
        sessionId,
        otp: otpValue,
      })

    console.log("[ussd-momo] POST payment (init)", {
      reference,
      amount,
      channel,
      moolreUssdNetwork: moolreNetworkCode,
      payer: payerPhone,
      packageName,
      hasOtp: Boolean(otp),
      callback: shouldIncludePaymentCallbackInRequest() ? getMoolrePaymentCallbackUrl() : "(omitted)",
    })

    // OTP submit: verify code, then trigger PIN prompt (second POST with otpcode "").
    if (otp) {
      const verifyParsed = await parseMoolrePaymentPost(makePayload(otp), authHeaders)
      if (!verifyParsed.ok) {
        console.error("[ussd-momo] OTP verify failed", verifyParsed.message, verifyParsed.raw)
        return {
          success: false,
          reference,
          message: verifyParsed.message || "OTP verification failed.",
          provider: "moolre",
          moolreCode: verifyParsed.code || undefined,
        }
      }

      console.log("[ussd-momo] OTP verify OK", { code: verifyParsed.code, message: verifyParsed.message })

      if (verifyParsed.code === "TP14") {
        return {
          success: false,
          reference,
          message: "Invalid or expired verification code. Check the SMS and try again.",
          provider: "moolre",
          moolreCode: verifyParsed.code,
        }
      }

      if (verifyParsed.code === "TR099") {
        return moolrePaymentSuccess(reference, verifyParsed, "PIN_PROMPT_SENT")
      }

      return triggerMoolrePinPrompt(reference, makePayload, authHeaders, channel)
    }

    const parsed = await parseMoolrePaymentPost(makePayload(""), authHeaders)
    if (!parsed.ok) {
      console.error("[ussd-momo] init failed", parsed.httpStatus, parsed.message, parsed.raw)
      return {
        success: false,
        reference,
        message: parsed.message,
        provider: "moolre",
        moolreCode: parsed.code || undefined,
      }
    }

    console.log("[ussd-momo] init OK", { code: parsed.code, message: parsed.message })

    // TP14 = Moolre sent a one-time SMS code to the payer. Re-post the SAME externalref with otpcode.
    if (parsed.code === "TP14" && !otp) {
      console.log("[ussd-momo] TP14 — payer must submit Moolre SMS code, then PIN prompt follows", {
        reference,
        channel,
      })
      return moolrePaymentSuccess(reference, parsed, "OTP_REQUIRED")
    }

    // TR099 = MoMo PIN approval prompt sent to payer's phone (USSD Pay path for verified numbers).
    if (parsed.code === "TR099") {
      console.log("[ussd-momo] TR099 — MoMo PIN prompt sent", { reference, channel })
      return moolrePaymentSuccess(reference, parsed, "PIN_PROMPT_SENT")
    }

    console.warn("[ussd-momo] unexpected Moolre success code — no PIN prompt registered", {
      reference,
      code: parsed.code || "(empty)",
      message: parsed.message,
    })
    return {
      success: false,
      reference,
      provider: "moolre",
      message:
        parsed.code === "TP14"
          ? "Complete Moolre SMS verification first, then try again."
          : `Moolre did not start the payment (${parsed.code || "unknown"}). The customer will not receive a PIN prompt.`,
      moolreCode: parsed.code,
      data: parsed.data,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[ussd-momo] Error:", msg)
    return { success: false, reference, message: msg, provider: "moolre" }
  }
}
