const MOOLRE_USERNAME = process.env.MOOLRE_USERNAME
const MOOLRE_PUBLIC_KEY = process.env.MOOLRE_PUBLIC_KEY
const MOOLRE_ACCOUNT_NUMBER = process.env.MOOLRE_ACCOUNT_NUMBER
const STATUS_URL = "https://api.moolre.com/open/transact/status"

/**
 * @param {string} externalref
 */
export async function checkMoolrePaymentStatus(externalref) {
  if (!MOOLRE_USERNAME || !MOOLRE_PUBLIC_KEY || !MOOLRE_ACCOUNT_NUMBER) {
    return { ok: false, error: "Moolre credentials not configured" }
  }

  const payload = {
    type: 1,
    idtype: "1",
    id: externalref,
    accountnumber: MOOLRE_ACCOUNT_NUMBER,
  }

  const response = await fetch(STATUS_URL, {
    method: "POST",
    headers: {
      "X-API-USER": MOOLRE_USERNAME,
      "X-API-PUBKEY": MOOLRE_PUBLIC_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    return { ok: false, error: "Invalid status response", raw: text?.slice(0, 200) }
  }

  const txstatus = data?.data?.txstatus ?? data?.data?.txStatus ?? null
  const txStatusNum = txstatus == null ? null : Number(txstatus)
  const apiOk = Number(data?.status) === 1 || Number(data?.status) === 200

  return {
    ok: apiOk,
    txStatusNum,
    isPaid: txStatusNum === 1,
    code: data?.code,
    message: data?.message,
    data: data?.data,
  }
}

/**
 * Poll Moolre if wallet webhook is delayed (backup for voucher + SMS).
 * @param {string} paymentReference
 * @param {(reference: string) => Promise<boolean>} onPaid
 */
export function scheduleUssdPaymentStatusPoll(paymentReference, onPaid) {
  const delays = String(process.env.USSD_PAYMENT_POLL_DELAYS_MS || "15000,45000,90000")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)

  for (const ms of delays) {
    setTimeout(() => {
      onPaid(paymentReference).catch((err) => {
        console.error("[ussd-poll] error", paymentReference, err)
      })
    }, ms)
  }
}
