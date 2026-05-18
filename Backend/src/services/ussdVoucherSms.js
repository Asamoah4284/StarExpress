import { sendSms } from "./sms.js"
import { buildSaleVoucherSmsMessage } from "./voucherSaleFulfillment.js"

/**
 * Send voucher SMS after USSD payment (same Moolre SMS as signup/agent sales).
 * Does not throw — returns { success, message } like As-market ticket SMS.
 *
 * @param {{ to: string, packageName: string, dataLimit?: string, voucherCode: string }} opts
 */
export async function sendUssdVoucherSms(opts) {
  const { to, packageName, dataLimit = "", voucherCode } = opts
  const message = buildSaleVoucherSmsMessage(packageName, dataLimit, voucherCode)

  console.log("[ussd-sms] Sending voucher SMS to", to, "voucher", voucherCode)

  try {
    const result = await sendSms({ to, message })
    if (result.skipped) {
      console.error("[ussd-sms] MOOLRE_API_KEY missing — SMS not sent")
      return { success: false, message: "SMS not configured (MOOLRE_API_KEY)" }
    }
    console.log("[ussd-sms] Sent OK to", to)
    return { success: true, message: "SMS sent" }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[ussd-sms] Failed:", msg)
    return { success: false, message: msg }
  }
}
