/**
 * Moolre SMS — send only from the backend (never from the browser).
 * Endpoint: https://api.moolre.com/open/sms/send
 *
 * Set in .env:
 *   MOOLRE_API_KEY or MOOLRE_SMS_API_KEY — JWT from Moolre (header X-API-VASKEY)
 *   MOOLRE_SENDER_ID — optional sender label
 *
 * Optional: MOOLRE_SMS_URL if Moolre changes the path.
 */

const DEFAULT_SMS_URL = "https://api.moolre.com/open/sms/send"

/** @returns {string | undefined} */
function getMoolreApiKey() {
  const key = process.env.MOOLRE_API_KEY || process.env.MOOLRE_SMS_API_KEY
  return key && String(key).trim() ? String(key).trim() : undefined
}

/**
 * @param {Response} response
 */
async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") || ""
  const raw = await response.text()
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(raw)
    } catch {
      return { raw }
    }
  }
  try {
    return JSON.parse(raw)
  } catch {
    return { raw }
  }
}

/**
 * Format phone for Moolre: international digits without + (e.g. 233XXXXXXXXX).
 * @param {string} phone
 */
export function formatPhoneForMoolre(phone) {
  if (phone == null || phone === "") {
    throw new Error("Valid phone number is required")
  }
  const clean = String(phone).replace(/[\s\-()]/g, "")
  let digits = clean.startsWith("+") ? clean.slice(1) : clean
  digits = digits.replace(/\D/g, "")
  if (digits.startsWith("0") && digits.length >= 10) {
    digits = `233${digits.slice(1)}`
  } else if (!digits.startsWith("233")) {
    digits = `233${digits}`
  }
  if (digits.length < 12) {
    throw new Error(`Invalid phone number after formatting: ${phone}`)
  }
  return digits
}

/**
 * @param {{ to: string, message: string }} opts
 * @returns {Promise<{ ok: boolean, skipped?: boolean, raw?: unknown }>}
 */
export async function sendSms({ to, message }) {
  const apiKey = getMoolreApiKey()
  const url = process.env.MOOLRE_SMS_URL || DEFAULT_SMS_URL

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMS is not configured. Set MOOLRE_API_KEY in environment.")
    }
    console.warn("[sms] MOOLRE_API_KEY missing — would send to", to, "→", message)
    return { ok: true, skipped: true }
  }

  const senderId = process.env.MOOLRE_SENDER_ID || "Starexpress"
  const recipient = formatPhoneForMoolre(to)

  const payload = {
    type: 1,
    senderid: senderId,
    messages: [{ recipient, message }],
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-VASKEY": apiKey,
    },
    body: JSON.stringify(payload),
  })

  const responseData = await parseResponseBody(response)

  const apiStatus = Number(
    responseData && typeof responseData === "object" ? responseData.status : NaN,
  )

  if (!response.ok) {
    const msg =
      typeof responseData === "object" && responseData !== null && "message" in responseData
        ? String(responseData.message)
        : JSON.stringify(responseData)
    const smsError = new Error(`Moolre SMS failed (${response.status}): ${msg}`)
    smsError.raw = responseData
    throw smsError
  }

  if (apiStatus !== 1) {
    const code =
      responseData && typeof responseData === "object" && responseData.code != null
        ? String(responseData.code)
        : ""
    const msg =
      typeof responseData === "object" && responseData !== null && responseData.message != null
        ? String(responseData.message)
        : JSON.stringify(responseData)
    if (code === "AIN01") {
      console.error(
        "[sms] Moolre SMS auth failed (AIN01). Use the VAS/SMS API key (X-API-VASKEY) from Moolre — not MOOLRE_PUBLIC_KEY.",
      )
    }
    const smsError = new Error(`Moolre SMS failed: ${msg}`)
    smsError.raw = responseData
    throw smsError
  }

  return { ok: true, raw: responseData }
}
