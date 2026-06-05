import { randomUUID } from "node:crypto"
import {
  USSD_SHORTCODE,
  formatPhoneNumber,
  generateAgentPaymentReference,
  getNetworkFromMsisdn,
  initiateMoMoPayment,
  resolvePaymentNetwork,
  submitMoMoPaymentWithOtp,
} from "../lib/ussdHelpers.js"
import { createUssdSessionStore } from "../lib/ussdSessionStore.js"
import { checkMoolrePaymentStatus, scheduleUssdPaymentStatusPoll } from "../lib/moolrePaymentStatus.js"
import { processPaymentSuccess } from "./paymentCompletion.js"
import { buildPackageAvailabilityFilter } from "./voucherSaleFulfillment.js"
import { resolvePackageForLocation } from "../lib/packageOverrides.js"

const AGENT_SESSION_TTL_MS = Number(process.env.AGENT_PAYMENT_SESSION_TTL_MS) || 20 * 60 * 1000

/**
 * @param {{
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   locations: import("mongodb").Collection
 *   users: import("mongodb").Collection
 *   ussdSessions: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   auth: { userId: string, role: string }
 *   packageId: string
 *   customerPhone: string
 *   paymentNetwork?: string
 *   locationId?: string
 *   findConflictingLocationForSalesAgent: (
 *     locationsCol: import("mongodb").Collection,
 *     usersCol: import("mongodb").Collection,
 *     userId: string,
 *     excludeLocationId: string | undefined,
 *   ) => Promise<import("mongodb").Document | null>
 * }} input
 */
export async function initiateAgentMoMoSale(input) {
  const {
    packages,
    vouchers,
    locations,
    users,
    ussdSessions,
    sales,
    auditLogs,
    auth,
    packageId,
    customerPhone,
    paymentNetwork,
    locationId: locationIdBody,
    findConflictingLocationForSalesAgent,
  } = input

  const phone = formatPhoneNumber(customerPhone)
  if (!phone) return { ok: false, status: 400, error: "Valid customer phone is required." }

  const pkg = await packages.findOne({ _id: packageId })
  if (!pkg) return { ok: false, status: 400, error: "Unknown package." }

  let locationId = ""
  if (auth.role === "Admin") {
    locationId = String(locationIdBody || "").trim()
    if (!locationId) {
      return { ok: false, status: 400, error: "locationId is required when recording a sale as administrator." }
    }
    const loc = await locations.findOne({ _id: locationId })
    if (!loc) return { ok: false, status: 400, error: "Unknown location." }
  } else {
    const loc = await findConflictingLocationForSalesAgent(locations, users, auth.userId, undefined)
    if (!loc) {
      return {
        ok: false,
        status: 403,
        error: "No location is assigned to your sales account. Ask an administrator to link you to a store.",
      }
    }
    locationId = String(loc._id)
  }

  const resolved = resolvePackageForLocation(pkg, locationId)
  if (resolved.status !== "Active") {
    return { ok: false, status: 400, error: "Only active packages can be sold." }
  }

  const amount = resolved.priceGHS
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, error: "Invalid package price." }
  }

  const availFilter = buildPackageAvailabilityFilter(packageId, locationId)
  const voucherAvailable = await vouchers.findOne(availFilter, { projection: { _id: 1 } })
  if (!voucherAvailable) {
    return { ok: false, status: 400, error: "No vouchers available for this package at this wifi location." }
  }

  const sessionId = `agent-${randomUUID().slice(0, 12)}`
  const paymentReference = generateAgentPaymentReference(sessionId)
  const network = resolvePaymentNetwork(phone, paymentNetwork)
  const now = new Date()
  const sessions = createUssdSessionStore(ussdSessions)

  await sessions.createSession({
    sessionId,
    phone,
    network,
    locationId,
    step: "awaiting_pin",
  })
  await sessions.updateSession(sessionId, {
    source: "agent",
    soldByUserId: auth.userId,
    paymentNetwork: network,
    paymentReference,
    selectedPackage: {
      packageId,
      name: resolved.name && resolved.name.trim() ? resolved.name.trim() : packageId,
      priceGHS: amount,
      dataLimit: resolved.dataLimit && resolved.dataLimit.trim() ? resolved.dataLimit.trim() : "",
    },
    expiresAt: new Date(now.getTime() + AGENT_SESSION_TTL_MS),
  })

  const momoResult = await initiateMoMoPayment(phone, amount, sessionId, {
    packageName: resolved.name,
    reference: paymentReference,
    network,
    networkOverride: paymentNetwork || undefined,
  })

  if (momoResult.moolreCode === "TP14" || momoResult.action === "OTP_REQUIRED") {
    await sessions.updateSession(sessionId, { step: "awaiting_pin" })
    return {
      ok: true,
      phase: "pin",
      paymentReference,
      sessionId,
      shortcode: USSD_SHORTCODE,
      detectedNetwork: network,
      message:
        "A verification PIN was sent to the customer's phone via SMS (same as USSD payments). Ask the customer for the PIN.",
    }
  }

  if (momoResult.moolreCode === "TR099" || momoResult.action === "PROMPT_TRIGGERED") {
    await sessions.updateSession(sessionId, { step: "momo_pending" })
    scheduleAgentPaymentPoll(paymentReference, { ussdSessions, packages, vouchers, sales, auditLogs })
    return {
      ok: true,
      phase: "momo",
      paymentReference,
      sessionId,
      shortcode: USSD_SHORTCODE,
      detectedNetwork: network,
      message:
        "MoMo payment prompt sent to the customer's phone. Ask them to enter their MoMo PIN to approve payment.",
      moolreCode: momoResult.moolreCode,
    }
  }

  await sessions.updateSession(sessionId, { step: "failed" })
  return {
    ok: false,
    status: 502,
    error: momoResult.message || "Could not start mobile money payment.",
    paymentReference,
    detectedNetwork: network,
  }
}

/**
 * @param {{
 *   ussdSessions: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   auth: { userId: string, role?: string }
 *   paymentReference: string
 *   pin: string
 * }} input
 */
export async function confirmAgentMoMoPin(input) {
  const { ussdSessions, packages, vouchers, sales, auditLogs, auth, paymentReference, pin } = input
  const sessions = createUssdSessionStore(ussdSessions)
  const session = await sessions.findByPaymentReference(paymentReference)

  if (!session || session.source !== "agent") {
    return { ok: false, status: 404, error: "Payment session not found or expired." }
  }
  if (session.soldByUserId && session.soldByUserId !== auth.userId && auth.role !== "Admin") {
    return { ok: false, status: 403, error: "This payment belongs to another agent." }
  }
  if (session.step !== "awaiting_pin") {
    return { ok: false, status: 409, error: "This payment is not waiting for a PIN." }
  }

  const otp = String(pin || "").trim()
  if (!/^\d{4,8}$/.test(otp)) {
    return { ok: false, status: 400, error: "Enter the 4–8 digit PIN the customer received by SMS." }
  }

  const selected = session.selectedPackage
  const amount = Number(selected?.priceGHS) || 0
  if (amount <= 0) {
    return { ok: false, status: 400, error: "Invalid payment amount on session." }
  }

  const network =
    typeof session.paymentNetwork === "string" && session.paymentNetwork.trim()
      ? session.paymentNetwork.trim()
      : resolvePaymentNetwork(String(session.phone), null)

  const momoResult = await submitMoMoPaymentWithOtp(String(session.phone), amount, String(session._id), {
    packageName: selected?.name || "WiFi package",
    reference: paymentReference,
    network,
    otpcode: otp,
  })

  if (!momoResult.success || (momoResult.moolreCode !== "TR099" && momoResult.action !== "PROMPT_TRIGGERED")) {
    return {
      ok: false,
      status: 502,
      error: momoResult.message || "Could not trigger MoMo payment. Check the PIN and try again.",
      moolreCode: momoResult.moolreCode,
      detectedNetwork: network,
    }
  }

  await sessions.updateSession(String(session._id), { step: "momo_pending" })
  scheduleAgentPaymentPoll(paymentReference, { ussdSessions, packages, vouchers, sales, auditLogs })

  return {
    ok: true,
    phase: "momo",
    paymentReference,
    message: "MoMo payment prompt sent. Ask the customer to enter their MoMo PIN on their phone to pay.",
    moolreCode: momoResult.moolreCode,
  }
}

/**
 * @param {{
 *   ussdSessions: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   paymentReference: string
 * }} input
 */
export async function getAgentMoMoPaymentStatus(input) {
  const { ussdSessions, packages, vouchers, sales, auditLogs, paymentReference } = input
  const sessions = createUssdSessionStore(ussdSessions)
  const session = await sessions.findByPaymentReference(paymentReference)

  const sale = await sales.findOne({ paymentReference })
  if (sale) {
    return {
      ok: true,
      status: "completed",
      sale: sale,
      voucherCode: sale.voucherCode,
      smsSent: sale.smsSent === true,
    }
  }

  if (!session || session.source !== "agent") {
    return { ok: false, status: 404, error: "Payment session not found." }
  }

  if (session.step === "awaiting_pin") {
    return { ok: true, status: "awaiting_pin", message: "Waiting for customer verification PIN." }
  }
  if (session.step === "momo_pending") {
    const paid = await checkMoolrePaymentStatus(paymentReference)
    if (paid.ok && paid.isPaid) {
      await processPaymentSuccess(
        paymentReference,
        { ussdSessions, packages, vouchers, sales, auditLogs },
        "agent-poll",
      )
      const completed = await sales.findOne({ paymentReference })
      if (completed) {
        return {
          ok: true,
          status: "completed",
          sale: completed,
          voucherCode: completed.voucherCode,
          smsSent: completed.smsSent === true,
        }
      }
    }
    return {
      ok: true,
      status: "awaiting_momo",
      message: "Waiting for customer to approve MoMo payment on their phone.",
    }
  }
  if (session.step === "failed") {
    return { ok: true, status: "failed", message: "Payment could not be started." }
  }

  return { ok: true, status: session.step || "unknown" }
}

/**
 * @param {string} paymentReference
 * @param {{
 *   ussdSessions: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 * }} deps
 */
function scheduleAgentPaymentPoll(paymentReference, deps) {
  scheduleUssdPaymentStatusPoll(paymentReference, async (reference) => {
    const existing = await deps.sales.findOne({ paymentReference: reference })
    if (existing) return true
    const status = await checkMoolrePaymentStatus(reference)
    if (!status.ok || !status.isPaid) return false
    const outcome = await processPaymentSuccess(
      reference,
      {
        ussdSessions: deps.ussdSessions,
        packages: deps.packages,
        vouchers: deps.vouchers,
        sales: deps.sales,
        auditLogs: deps.auditLogs,
      },
      "agent-poll",
    )
    return outcome.ok === true
  })
}
