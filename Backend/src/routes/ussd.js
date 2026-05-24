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
import { checkMoolrePaymentStatus, scheduleUssdPaymentStatusPoll } from "../lib/moolrePaymentStatus.js"
import { getMoolreWebhookPayload, parseMoolrePaymentEvent } from "../lib/moolreWebhook.js"
import {
  buildLocationAvailabilityFilter,
  buildPackageAvailabilityFilter,
  fulfillUssdVoucherSale,
} from "../services/voucherSaleFulfillment.js"
import { sendUssdVoucherSms } from "../services/ussdVoucherSms.js"

const MAX_PACKAGES_IN_MENU = 8
const MAX_LOCATIONS_IN_MENU = 8

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

  /**
   * Fulfill voucher sale + SMS after Moolre confirms payment (webhook or status poll).
   * @param {string} paymentReference
   * @param {string} source
   */
  async function processUssdPaymentSuccess(paymentReference, source = "webhook") {
    const existingSale = await sales.findOne({ paymentReference })
    if (existingSale) {
      console.log(`[ussd-pay] ${source} idempotent`, paymentReference, existingSale._id)
      if (existingSale.voucherCode && existingSale.customerPhone && existingSale.smsSent !== true) {
        const sms = await sendUssdVoucherSms({
          to: String(existingSale.customerPhone),
          packageName: String(existingSale.packageType || "WiFi"),
          voucherCode: String(existingSale.voucherCode),
        })
        if (sms.success) {
          await sales.updateOne({ _id: existingSale._id }, { $set: { smsSent: true } })
        }
      }
      return { ok: true, status: "already_processed", saleId: existingSale._id }
    }

    const ussdSession = await sessions.findByPaymentReference(paymentReference)
    if (!ussdSession) {
      console.warn(`[ussd-pay] ${source} no session for`, paymentReference)
      return { ok: false, status: "no_session" }
    }

    const selected = ussdSession.selectedPackage
    const packageId = selected?.packageId
    const locationId = ussdSession.locationId || getUssdLocationId()
    const customerPhone = ussdSession.phone

    if (!packageId || !locationId || !customerPhone) {
      console.error(`[ussd-pay] ${source} invalid session`, paymentReference)
      return { ok: false, status: "invalid_session" }
    }

    const result = await fulfillUssdVoucherSale({
      packages,
      vouchers,
      sales,
      auditLogs,
      paymentReference,
      customerPhone: String(customerPhone),
      packageId: String(packageId),
      locationId: String(locationId),
    })

    await sessions.updateSession(String(ussdSession._id), { step: "completed" })

    if (!result.ok) {
      console.error(`[ussd-pay] ${source} fulfillment failed`, paymentReference, result.error)
      return { ok: false, status: "fulfillment_failed", error: result.error }
    }

    console.log(
      `[ussd-pay] ${source} success`,
      paymentReference,
      result.voucherCode,
      "smsSent=",
      result.smsSent,
    )
    return {
      ok: true,
      status: "success",
      saleId: result.sale?._id,
      voucherCode: result.voucherCode,
      smsSent: result.smsSent,
    }
  }

  /** @param {string} paymentReference */
  async function tryConfirmPaymentFromPoll(paymentReference) {
    const existing = await sales.findOne({ paymentReference })
    if (existing) return true

    const status = await checkMoolrePaymentStatus(paymentReference)
    console.log("[ussd-poll] status", paymentReference, status)
    if (!status.ok || !status.isPaid) return false

    const outcome = await processUssdPaymentSuccess(paymentReference, "poll")
    return outcome.ok === true
  }

  function menuWelcome() {
    return `Welcome to Tabitacum WiFi\n1) Buy voucher\n2) Exit\n`
  }

  /**
   * @param {string} locationId
   */
  /**
   * Wifi locations with at least one unused voucher (optional USSD_DEFAULT_LOCATION_ID whitelist).
   * @returns {Promise<{ locationId: string, name: string }[]>}
   */
  async function getLocationsForUssdMenu() {
    const forcedId = getUssdLocationId()
    const locDocs = await locations.find({}).sort({ name: 1 }).limit(MAX_LOCATIONS_IN_MENU).toArray()
    /** @type {{ locationId: string, name: string }[]} */
    const list = []
    for (const loc of locDocs) {
      const locationId = String(loc._id)
      if (forcedId && locationId !== forcedId) continue
      const remaining = await vouchers.countDocuments(buildLocationAvailabilityFilter(locationId))
      if (remaining > 0) {
        list.push({
          locationId,
          name: typeof loc.name === "string" && loc.name.trim() ? loc.name.trim() : locationId,
        })
      }
    }
    return list
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

  /**
   * @param {string} sessionId
   * @param {string} locationId
   */
  async function beginPackageSelection(sessionId, locationId) {
    const loc = await locations.findOne({ _id: locationId })
    if (!loc) {
      return {
        message: "Location not available. Try again later.",
        reply: false,
      }
    }

    const packageList = await getPackagesForUssdMenu(locationId)
    if (packageList.length === 0) {
      return {
        message: "No vouchers available at this location. Try another location or try again later.",
        reply: false,
      }
    }

    await sessions.updateSession(sessionId, {
      step: "select_package",
      locationId,
      packageList,
    })

    const locName = typeof loc.name === "string" && loc.name.trim() ? loc.name.trim() : locationId
    const lines = packageList.map((p, i) => `${i + 1}) ${p.name} - GHS ${p.priceGHS}`)
    return {
      message: `${locName}\nSelect package:\n${lines.join("\n")}`,
      reply: true,
    }
  }

  /**
   * After user chooses Buy voucher: pick location (if needed) or go straight to packages.
   * @param {string} sessionId
   */
  async function beginBuyFlow(sessionId) {
    const locationList = await getLocationsForUssdMenu()
    if (locationList.length === 0) {
      return {
        message: "No vouchers available right now. Try again later.",
        reply: false,
      }
    }
    if (locationList.length === 1) {
      return beginPackageSelection(sessionId, locationList[0].locationId)
    }
    await sessions.updateSession(sessionId, { step: "select_location", locationList })
    const lines = locationList.map((l, i) => `${i + 1}) ${l.name}`)
    return {
      message: `Select wifi location:\n${lines.join("\n")}`,
      reply: true,
    }
  }

  router.get("/health", async (_req, res) => {
    try {
      const locationList = await getLocationsForUssdMenu()
      res.json({
        status: "ok",
        service: "starexpress-ussd",
        shortcode: USSD_SHORTCODE,
        locationWhitelist: Boolean(getUssdLocationId()),
        locationsWithStock: locationList.length,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      res.json({
        status: "ok",
        service: "starexpress-ussd",
        shortcode: USSD_SHORTCODE,
        timestamp: new Date().toISOString(),
      })
    }
  })

  router.get("/packages", async (req, res) => {
    try {
      const queryLocationId =
        typeof req.query?.locationId === "string" ? req.query.locationId.trim() : ""
      const forcedId = getUssdLocationId()
      const locationList = await getLocationsForUssdMenu()

      if (queryLocationId) {
        const loc = await locations.findOne({ _id: queryLocationId })
        if (!loc) return res.status(404).json({ error: "Unknown location." })
        if (forcedId && queryLocationId !== forcedId) {
          return res.status(403).json({ error: "Location not enabled for USSD." })
        }
        const items = await getPackagesForUssdMenu(queryLocationId)
        return res.json({
          shortcode: USSD_SHORTCODE,
          locationId: queryLocationId,
          locationName: typeof loc.name === "string" ? loc.name : queryLocationId,
          packages: items,
        })
      }

      const withPackages = await Promise.all(
        locationList.map(async (entry) => {
          const items = await getPackagesForUssdMenu(entry.locationId)
          return { ...entry, packages: items }
        }),
      )

      res.json({
        shortcode: USSD_SHORTCODE,
        locationWhitelist: Boolean(forcedId),
        locations: withPackages,
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

      const forcedLocationId = getUssdLocationId()
      if (forcedLocationId) {
        const forcedLoc = await locations.findOne({ _id: forcedLocationId })
        if (!forcedLoc) {
          console.error("[ussd] Unknown USSD_DEFAULT_LOCATION_ID:", forcedLocationId)
          return res.json({
            message: "WiFi location not configured. Contact support.",
            reply: false,
          })
        }
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
            const buyFlow = await beginBuyFlow(sessionId)
            return res.json(buyFlow)
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

        case "select_location": {
          const locationList = Array.isArray(session?.locationList) ? session.locationList : []
          const num = parseInt(input, 10)
          if (!Number.isFinite(num) || num < 1 || num > locationList.length) {
            const lines = locationList.map((/** @type {{ name: string }} */ l, i) => `${i + 1}) ${l.name}`)
            return res.json({
              message: `Invalid option.\nSelect wifi location:\n${lines.join("\n")}`,
              reply: true,
            })
          }
          const chosenLoc = locationList[num - 1]
          const packageStep = await beginPackageSelection(sessionId, chosenLoc.locationId)
          return res.json(packageStep)
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

            const payLocationId = String(session?.locationId || "").trim()
            if (!payLocationId) {
              return res.json({
                message: `Session expired. Dial ${USSD_SHORTCODE} to start again.`,
                reply: false,
              })
            }

            await sessions.updateSession(sessionId, {
              paymentReference,
              step: "payment",
              selectedPackage: session?.selectedPackage || selected,
              phone,
              locationId: payLocationId,
            })

            const moolreNet = session?.moolreNetwork ?? validMoolreNetwork
            const momoDelayMs = Number(process.env.USSD_MOMO_START_DELAY_MS) || 1500
            setTimeout(() => {
              initiateMoMoPayment(phone, amount, sessionId, {
                packageName: selected.name,
                reference: paymentReference,
                network: session?.network || normalizedNetwork,
                moolreNetwork: moolreNet,
              })
                .then((result) => {
                  console.log(
                    "[ussd] momo result",
                    paymentReference,
                    result?.success,
                    result?.action,
                    result?.moolreCode,
                    result?.message,
                  )
                  if (!result?.success) {
                    console.error("[ussd] momo failed — user will not see PIN prompt:", result?.message)
                    return
                  }
                  scheduleUssdPaymentStatusPoll(paymentReference, tryConfirmPaymentFromPoll)
                })
                .catch((err) => {
                  console.error("[ussd] momo error", paymentReference, err)
                })
            }, momoDelayMs)

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

  /** Moolre wallet callback + payment confirmation (As-market pattern). */
  async function handleMoolrePaymentWebhook(req, res) {
    try {
      const payload = getMoolreWebhookPayload(req)
      const event = parseMoolrePaymentEvent(payload)

      console.log("[ussd-webhook] received", {
        reference: event.reference,
        txStatusNum: event.txStatusNum,
        code: event.code,
        contentType: req.get("content-type"),
        bodyKeys: Object.keys(payload || {}),
      })

      if (!verifyMoolreWebhook(payload, req.headers)) {
        console.error("[ussd-webhook] invalid secret")
        return res.status(401).json({ error: "Invalid webhook" })
      }

      if (!event.reference) {
        console.error("[ussd-webhook] missing externalref", JSON.stringify(payload).slice(0, 500))
        return res.status(200).json({ received: true, error: "Missing externalref" })
      }

      if (event.isFailed) {
        const ussdSession = await sessions.findByPaymentReference(event.reference)
        if (ussdSession) await sessions.updateSession(String(ussdSession._id), { step: "completed" })
        return res.status(200).json({ received: true, status: "failed" })
      }

      if (event.isPending && !event.isSuccess) {
        return res.status(200).json({ received: true, status: "pending" })
      }

      if (!event.isSuccess) {
        return res.status(200).json({ received: true, status: "ignored", code: event.code })
      }

      const outcome = await processUssdPaymentSuccess(event.reference, "webhook")
      return res.status(200).json({ received: true, ...outcome })
    } catch (err) {
      console.error("[ussd-webhook] error", err)
      return res.status(200).json({
        received: true,
        error: err instanceof Error ? err.message : "Webhook processing failed",
      })
    }
  }

  router.post("/payments/webhook", handleMoolrePaymentWebhook)

  return { router, handleMoolrePaymentWebhook }
}
