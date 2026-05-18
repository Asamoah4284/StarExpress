import express from "express"
import {
  USSD_SHORTCODE,
  formatPhoneNumber,
  generatePaymentReference,
  getUssdPayload,
  initiateMoMoPayment,
  normalizeNetworkName,
  normalizeUssdPayload,
  verifyMoolreWebhook,
} from "../lib/ussdHelpers.js"
import { createUssdSessionStore } from "../lib/ussdSessionStore.js"
import {
  buildPackageAvailabilityFilter,
  fulfillUssdVoucherSale,
} from "../services/voucherSaleFulfillment.js"

const MAX_PACKAGES_IN_MENU = 8

/**
 * @param {{
 *   ussdSessions: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   locations: import("mongodb").Collection
 * }} deps
 */
export function createUssdRouter(deps) {
  const { ussdSessions, packages, vouchers, sales, auditLogs, locations } = deps
  const sessions = createUssdSessionStore(ussdSessions)
  const router = express.Router()

  function getUssdLocationId() {
    return String(process.env.USSD_DEFAULT_LOCATION_ID || "").trim()
  }

  function menuWelcome() {
    return `Welcome to StarExpress WiFi\n1) Buy voucher\n2) Exit\nDial ${USSD_SHORTCODE}`
  }

  /**
   * @param {string} locationId
   */
  async function getPackagesForUssdMenu(locationId) {
    if (!locationId) return []

    const activePkgs = await packages
      .find({ status: "Active" })
      .sort({ name: 1 })
      .limit(MAX_PACKAGES_IN_MENU)
      .toArray()

    /** @type {{ packageId: string, name: string, priceGHS: number, dataLimit: string, remaining: number }[]} */
    const list = []
    for (const pkg of activePkgs) {
      const packageId = String(pkg._id)
      const remaining = await vouchers.countDocuments(buildPackageAvailabilityFilter(packageId, locationId))
      if (remaining > 0) {
        list.push({
          packageId,
          name: typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : packageId,
          priceGHS: Number(pkg.priceGHS) || 0,
          dataLimit: typeof pkg.dataLimit === "string" ? pkg.dataLimit.trim() : "",
          remaining,
        })
      }
    }
    return list
  }

  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "starexpress-ussd",
      shortcode: USSD_SHORTCODE,
      locationConfigured: Boolean(getUssdLocationId()),
      timestamp: new Date().toISOString(),
    })
  })

  router.get("/packages", async (_req, res) => {
    try {
      const locationId = getUssdLocationId()
      if (!locationId) {
        return res.status(503).json({ error: "USSD_DEFAULT_LOCATION_ID is not configured." })
      }
      const loc = await locations.findOne({ _id: locationId })
      const items = await getPackagesForUssdMenu(locationId)
      res.json({
        shortcode: USSD_SHORTCODE,
        locationId,
        locationName: loc && typeof loc.name === "string" ? loc.name : locationId,
        packages: items,
      })
    } catch (err) {
      console.error("[ussd] GET /packages", err)
      res.status(500).json({ error: "Failed to load packages." })
    }
  })

  router.post("/", async (req, res) => {
    try {
      const rawPayload = getUssdPayload(req)
      const { sessionId, isNewSession, msisdn, network, userInput } = normalizeUssdPayload(rawPayload)

      console.log("[ussd] request", {
        sessionId,
        isNewSession,
        msisdn: msisdn ? `${String(msisdn).slice(0, 6)}…` : null,
        network,
        input: String(userInput || "").slice(0, 40),
      })

      if (!sessionId || !msisdn) {
        return res.json({ message: "Invalid request. Please try again.", reply: false })
      }

      const locationId = getUssdLocationId()
      if (!locationId) {
        console.error("[ussd] USSD_DEFAULT_LOCATION_ID not set")
        return res.json({
          message: "WiFi sales are not configured. Contact support.",
          reply: false,
        })
      }

      const loc = await locations.findOne({ _id: locationId })
      if (!loc) {
        console.error("[ussd] Unknown USSD_DEFAULT_LOCATION_ID:", locationId)
        return res.json({
          message: "WiFi location not configured. Contact support.",
          reply: false,
        })
      }

      const phone = formatPhoneNumber(msisdn)
      if (!phone) {
        return res.json({ message: "Invalid phone number.", reply: false })
      }

      const normalizedNetwork = normalizeNetworkName(network, msisdn)
      const moolreNetworkNum = network != null ? Number(network) : null
      const validMoolreNetwork =
        moolreNetworkNum === 3 || moolreNetworkNum === 5 || moolreNetworkNum === 6 ? moolreNetworkNum : null

      const isNew =
        isNewSession === true ||
        isNewSession === "true" ||
        isNewSession === 1 ||
        isNewSession === "1"

      if (isNew) {
        await sessions.createSession({
          sessionId,
          phone,
          network: normalizedNetwork,
          moolreNetwork: validMoolreNetwork,
          locationId,
          step: "menu",
        })
        return res.json({ message: menuWelcome(), reply: true })
      }

      let session = await sessions.findSession(sessionId)
      if (!session) {
        await sessions.createSession({
          sessionId,
          phone,
          network: normalizedNetwork,
          moolreNetwork: validMoolreNetwork,
          locationId,
          step: "menu",
        })
        return res.json({ message: menuWelcome(), reply: true })
      }

      if (validMoolreNetwork != null) {
        await sessions.updateSession(sessionId, { moolreNetwork: validMoolreNetwork })
        session = await sessions.findSession(sessionId)
      }

      const input = String(userInput || "").trim()
      const step = session?.step || "menu"

      switch (step) {
        case "menu": {
          if (input === "1") {
            const packageList = await getPackagesForUssdMenu(locationId)
            if (packageList.length === 0) {
              return res.json({
                message: "No vouchers available right now. Try again later.",
                reply: false,
              })
            }
            await sessions.updateSession(sessionId, { step: "select_package", packageList })
            const lines = packageList.map(
              (p, i) => `${i + 1}) ${p.name} - GHS ${p.priceGHS}`,
            )
            return res.json({
              message: `Select package:\n${lines.join("\n")}`,
              reply: true,
            })
          }
          if (input === "2") {
            await sessions.updateSession(sessionId, { step: "completed" })
            return res.json({
              message: "Thank you for using StarExpress. Goodbye!",
              reply: false,
            })
          }
          return res.json({
            message: `Invalid option.\n${menuWelcome()}`,
            reply: true,
          })
        }

        case "select_package": {
          const packageList = Array.isArray(session?.packageList) ? session.packageList : []
          const num = parseInt(input, 10)
          if (!Number.isFinite(num) || num < 1 || num > packageList.length) {
            const lines = packageList.map((/** @type {{ name: string, priceGHS: number }} */ p, i) =>
              `${i + 1}) ${p.name} - GHS ${p.priceGHS}`,
            )
            return res.json({
              message: `Invalid option.\nSelect package:\n${lines.join("\n")}`,
              reply: true,
            })
          }
          const chosen = packageList[num - 1]
          await sessions.updateSession(sessionId, {
            step: "confirm_pay",
            selectedPackage: {
              packageId: chosen.packageId,
              name: chosen.name,
              priceGHS: chosen.priceGHS,
              dataLimit: chosen.dataLimit || "",
            },
          })
          const limitLine = chosen.dataLimit ? `\nData: ${chosen.dataLimit}` : ""
          return res.json({
            message: `${chosen.name}${limitLine}\nPrice: GHS ${chosen.priceGHS}\n1) Pay\n2) Cancel`,
            reply: true,
          })
        }

        case "confirm_pay": {
          const selected = session?.selectedPackage
          if (!selected?.packageId) {
            return res.json({
              message: `Session expired. Dial ${USSD_SHORTCODE} to start again.`,
              reply: false,
            })
          }

          if (input === "1") {
            const paymentReference = generatePaymentReference(sessionId)
            const amount = Number(selected.priceGHS) || 0
            if (amount <= 0) {
              return res.json({ message: "Invalid package price. Contact support.", reply: false })
            }

            await sessions.updateSession(sessionId, {
              paymentReference,
              step: "payment",
            })

            const moolreNet = session?.moolreNetwork ?? validMoolreNetwork
            setImmediate(() => {
              initiateMoMoPayment(phone, amount, sessionId, {
                packageName: selected.name,
                description: `StarExpress ${selected.name}`,
                reference: paymentReference,
                network: session?.network || normalizedNetwork,
                moolreNetwork: moolreNet,
              })
                .then((result) => {
                  console.log("[ussd] momo initiated", paymentReference, result?.success, result?.action)
                })
                .catch((err) => {
                  console.error("[ussd] momo error", paymentReference, err)
                })
            })

            return res.json({
              message:
                "Approve the MoMo payment on your phone. You will receive an SMS with your WiFi voucher.",
              reply: false,
            })
          }

          if (input === "2") {
            await sessions.updateSession(sessionId, { step: "completed" })
            return res.json({
              message: "Purchase cancelled. Thank you for using StarExpress.",
              reply: false,
            })
          }

          const limitLine = selected.dataLimit ? `\nData: ${selected.dataLimit}` : ""
          return res.json({
            message: `Invalid option.\n${selected.name}${limitLine}\nPrice: GHS ${selected.priceGHS}\n1) Pay\n2) Cancel`,
            reply: true,
          })
        }

        case "payment":
          await sessions.updateSession(sessionId, { step: "completed" })
          return res.json({
            message: "Payment is processing. Check your phone for the MoMo prompt.",
            reply: false,
          })

        case "completed":
          return res.json({
            message: `Session ended. Dial ${USSD_SHORTCODE} to buy again.`,
            reply: false,
          })

        default:
          await sessions.updateSession(sessionId, { step: "menu" })
          return res.json({ message: menuWelcome(), reply: true })
      }
    } catch (err) {
      console.error("[ussd] callback error", err)
      return res.json({ message: "An error occurred. Please try again.", reply: false })
    }
  })

  /** Moolre wallet "Callback URL" + USSD MoMo confirmation (same handler). */
  async function handleMoolrePaymentWebhook(req, res) {
    try {
      const payload = req.body || {}
      const reference = payload.data?.externalref ?? payload.externalref ?? null
      const txStatus = payload.data?.txstatus ?? payload.txstatus ?? null

      console.log("[ussd-webhook] received", { reference, txStatus })

      if (!verifyMoolreWebhook(payload, req.headers)) {
        console.error("[ussd-webhook] invalid secret")
        return res.status(401).json({ error: "Invalid webhook" })
      }

      if (!reference) {
        return res.status(400).json({ error: "Missing externalref" })
      }

      const txStatusNum = txStatus == null ? null : Number(txStatus)
      const status = txStatusNum === 1 ? "success" : txStatusNum === 2 ? "failed" : "pending"

      const ussdSession = await sessions.findByPaymentReference(reference)

      if (status === "failed") {
        if (ussdSession) await sessions.updateSession(String(ussdSession._id), { step: "completed" })
        return res.json({ ok: true, status: "failed" })
      }

      if (status === "pending") {
        return res.json({ ok: true, status: "pending" })
      }

      if (!ussdSession) {
        console.warn("[ussd-webhook] no session for reference", reference)
        return res.json({ ok: true, status: "no_session" })
      }

      const existingSale = await sales.findOne({ paymentReference: reference })
      if (existingSale) {
        console.log("[ussd-webhook] idempotent", reference)
        await sessions.updateSession(String(ussdSession._id), { step: "completed" })
        return res.json({ ok: true, status: "already_processed", saleId: existingSale._id })
      }

      const selected = ussdSession.selectedPackage
      const packageId = selected?.packageId
      const locationId = ussdSession.locationId || getUssdLocationId()
      const customerPhone = ussdSession.phone

      if (!packageId || !locationId || !customerPhone) {
        console.error("[ussd-webhook] session missing package/location/phone", reference)
        return res.status(400).json({ error: "Invalid session data" })
      }

      const result = await fulfillUssdVoucherSale({
        packages,
        vouchers,
        sales,
        auditLogs,
        paymentReference: reference,
        customerPhone,
        packageId: String(packageId),
        locationId: String(locationId),
      })

      await sessions.updateSession(String(ussdSession._id), { step: "completed" })

      if (!result.ok) {
        console.error("[ussd-webhook] fulfillment failed", reference, result.error)
        return res.status(500).json({ error: result.error || "Fulfillment failed" })
      }

      console.log("[ussd-webhook] success", reference, result.voucherCode)
      return res.json({
        ok: true,
        status: "success",
        saleId: result.sale?._id,
        voucherCode: result.voucherCode,
        idempotent: Boolean(result.idempotent),
      })
    } catch (err) {
      console.error("[ussd-webhook] error", err)
      return res.status(500).json({ error: "Webhook processing failed" })
    }
  }

  router.post("/payments/webhook", handleMoolrePaymentWebhook)

  return { router, handleMoolrePaymentWebhook }
}
