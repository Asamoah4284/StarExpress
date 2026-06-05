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
} from "../services/voucherSaleFulfillment.js"
import { resolvePackageForLocation } from "../lib/packageOverrides.js"
import { processPaymentSuccess } from "../services/paymentCompletion.js"

// Upper cap on how many active packages we fetch per location. USSD sessions are short-lived
// so this only bounds the DB result size — the actual menu is paginated below.
const MAX_PACKAGES_IN_MENU = 24
const MAX_LOCATIONS_IN_MENU = 8
// USSD turns are limited to ~160–180 characters by most gateways, so we paginate package lists
// and surface a trailing "More" entry to advance to the next page.
const PACKAGES_PER_PAGE = 4

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

  /** Fallback when session has no location (legacy). Does not limit the location menu. */
  function getUssdFallbackLocationId() {
    return String(process.env.USSD_DEFAULT_LOCATION_ID || "").trim()
  }

  /** @param {string} paymentReference @param {string} [source] */
  async function processUssdPaymentSuccess(paymentReference, source = "webhook") {
    return processPaymentSuccess(
      paymentReference,
      { ussdSessions, packages, vouchers, sales, auditLogs },
      source,
    )
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
    return `WELCOME TO TABITACUM-WIFI\n1) Buy voucher\n2) Retrieve voucher\n3) Exit\n`
  }

  // How many of the caller's recent vouchers to surface when they pick "Retrieve voucher".
  // Keep small so the response fits one USSD turn (~160 chars).
  const RETRIEVE_VOUCHER_LIMIT = 3

  /**
   * Match a sale's stored `customerPhone` whether it was saved by USSD (E.164-without-plus,
   * e.g. "233241234567") or typed by an admin in any of "0241234567", "+233241234567", or
   * with spaces in between. We match on the trailing 9 national digits with optional
   * non-digit separators so all of those formats hit.
   *
   * @param {string} formattedPhone The output of `formatPhoneNumber` (e.g. "233241234567").
   */
  function customerPhoneTrailingDigitsRegex(formattedPhone) {
    const national = String(formattedPhone || "").slice(-9)
    if (national.length < 7) return null
    const pattern = national.split("").join("\\D*")
    return new RegExp(`${pattern}$`)
  }

  /**
   * Compact date label for USSD output: "26 May".
   * Accepts ISO strings ("2026-05-26..."), "YYYY-MM-DD", or anything Date can parse.
   * @param {unknown} value
   */
  function formatVoucherDateLabel(value) {
    if (!value) return ""
    const d = new Date(String(value))
    if (Number.isNaN(d.getTime())) {
      const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})/)
      if (!m) return ""
      const day = Number(m[3])
      const monthIdx = Number(m[2]) - 1
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
      return `${day} ${months[monthIdx] || ""}`.trim()
    }
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return `${d.getDate()} ${months[d.getMonth()]}`
  }

  /**
   * Look up the caller's most recent voucher sales by phone. Sales without a `voucherCode`
   * (e.g. cancelled or failed fulfilment) are filtered out.
   * @param {string} formattedPhone
   */
  async function findRecentVouchersForPhone(formattedPhone) {
    const regex = customerPhoneTrailingDigitsRegex(formattedPhone)
    if (!regex) return []
    const docs = await sales
      .find({
        customerPhone: { $regex: regex },
        voucherCode: { $exists: true, $nin: [null, ""] },
      })
      .sort({ date: -1, _id: -1 })
      .limit(RETRIEVE_VOUCHER_LIMIT)
      .toArray()
    return docs.map((d) => ({
      voucherCode: String(d.voucherCode || "").trim(),
      packageName: typeof d.packageType === "string" && d.packageType.trim() ? d.packageType.trim() : "WiFi",
      date: formatVoucherDateLabel(d.date),
    }))
  }

  /**
   * Build the "Retrieve voucher" USSD response from the caller's recent sales.
   * @param {string} formattedPhone
   */
  async function buildRetrieveVoucherResponse(formattedPhone) {
    const items = await findRecentVouchersForPhone(formattedPhone)
    if (items.length === 0) {
      return {
        message:
          "No vouchers found for this number.\nIf you just paid, wait a moment and dial again, or contact support.",
        reply: false,
      }
    }
    const [latest, ...older] = items
    const lines = [
      "Your voucher:",
      latest.voucherCode,
      `${latest.packageName}${latest.date ? ` - ${latest.date}` : ""}`,
    ]
    if (older.length > 0) {
      lines.push("", "Earlier:")
      for (const v of older) {
        lines.push(`- ${v.voucherCode}${v.date ? ` (${v.date})` : ""}`)
      }
    }
    return { message: lines.join("\n"), reply: false }
  }

  /**
   * Wifi locations with at least one unused voucher (all sites — user picks in menu).
   * @returns {Promise<{ locationId: string, name: string }[]>}
   */
  async function getLocationsForUssdMenu() {
    const locDocs = await locations.find({}).sort({ name: 1 }).limit(MAX_LOCATIONS_IN_MENU).toArray()
    /** @type {{ locationId: string, name: string }[]} */
    const list = []
    for (const loc of locDocs) {
      const locationId = String(loc._id)
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

    // Fetch by price ascending so cheaper plans are surfaced first in the USSD menu.
    const activePkgs = await packages
      .find({ status: "Active" })
      .sort({ priceGHS: 1, name: 1 })
      .limit(MAX_PACKAGES_IN_MENU)
      .toArray()

    /** @type {{ packageId: string, name: string, priceGHS: number, dataLimit: string, remaining: number }[]} */
    const list = []
    for (const pkg of activePkgs) {
      const packageId = String(pkg._id)
      const resolved = resolvePackageForLocation(pkg, locationId)
      if (resolved.status && resolved.status !== "Active") continue
      const remaining = await vouchers.countDocuments(buildPackageAvailabilityFilter(packageId, locationId))
      if (remaining > 0) {
        list.push({
          packageId,
          name: resolved.name && resolved.name.trim() ? resolved.name.trim() : packageId,
          priceGHS: resolved.priceGHS,
          dataLimit: resolved.dataLimit,
          remaining,
        })
      }
    }
    // Resolve-aware sort: handles any leftover legacy per-location override prices that may differ
    // from the base price returned by the Mongo sort above.
    list.sort((a, b) => {
      const pa = Number(a.priceGHS)
      const pb = Number(b.priceGHS)
      if (!Number.isFinite(pa) && !Number.isFinite(pb)) return 0
      if (!Number.isFinite(pa)) return 1
      if (!Number.isFinite(pb)) return -1
      if (pa !== pb) return pa - pb
      return String(a.name).localeCompare(String(b.name))
    })
    return list
  }

  // Hard cap on how many characters of a package name we render in the USSD menu.
  // Keeps the per-line length predictable so 4 entries + "5) More" + the location header
  // all fit within a single USSD turn (~160 chars).
  const PACKAGE_NAME_MAX_LEN = 22

  /**
   * @param {string} name
   */
  function shortenPackageName(name) {
    const t = typeof name === "string" ? name.trim() : ""
    if (!t) return ""
    if (t.length <= PACKAGE_NAME_MAX_LEN) return t
    return `${t.slice(0, PACKAGE_NAME_MAX_LEN - 1).trimEnd()}…`
  }

  /**
   * Format a price as "GHS{N}" — drops the decimal when whole, keeps two places otherwise.
   * @param {number | string} value
   */
  function formatPriceForUssd(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return "GHS?"
    if (Number.isInteger(n)) return `GHS${n}`
    return `GHS${n.toFixed(2).replace(/\.?0+$/, "")}`
  }

  /**
   * Build one page of the package menu plus a trailing "More" entry when more pages remain.
   * The "More" option always takes the next slot after the visible packages on this page.
   *
   * @param {{ name: string, priceGHS: number }[]} packageList
   * @param {number} page
   * @returns {{ lines: string[], pageSize: number, hasMore: boolean, moreOption: number }}
   */
  function buildPackageMenuPage(packageList, page) {
    const safePage = Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0
    const start = safePage * PACKAGES_PER_PAGE
    const slice = packageList.slice(start, start + PACKAGES_PER_PAGE)
    const lines = slice.map(
      (p, i) => `${i + 1}) ${shortenPackageName(p.name)} ${formatPriceForUssd(p.priceGHS)}`,
    )
    const hasMore = start + slice.length < packageList.length
    if (hasMore) lines.push(`${slice.length + 1}) More`)
    return { lines, pageSize: slice.length, hasMore, moreOption: slice.length + 1 }
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
      packagePage: 0,
    })

    const locName = typeof loc.name === "string" && loc.name.trim() ? loc.name.trim() : locationId
    const { lines } = buildPackageMenuPage(packageList, 0)
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
        service: "Starexpress-ussd",
        shortcode: USSD_SHORTCODE,
        fallbackLocationId: getUssdFallbackLocationId() || null,
        locationsWithStock: locationList.length,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      res.json({
        status: "ok",
        service: "Starexpress-ussd",
        shortcode: USSD_SHORTCODE,
        timestamp: new Date().toISOString(),
      })
    }
  })

  router.get("/packages", async (req, res) => {
    try {
      const queryLocationId =
        typeof req.query?.locationId === "string" ? req.query.locationId.trim() : ""
      const locationList = await getLocationsForUssdMenu()

      if (queryLocationId) {
        const loc = await locations.findOne({ _id: queryLocationId })
        if (!loc) return res.status(404).json({ error: "Unknown location." })
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
            const retrieveResponse = await buildRetrieveVoucherResponse(phone)
            await sessions.updateSession(sessionId, { step: "completed" })
            return res.json(retrieveResponse)
          }
          if (input === "3") {
            await sessions.updateSession(sessionId, { step: "completed" })
            return res.json({
              message: "Thank you for using Starexpress. Goodbye!",
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
          const currentPage =
            Number.isFinite(Number(session?.packagePage)) && Number(session?.packagePage) >= 0
              ? Math.floor(Number(session.packagePage))
              : 0
          const { pageSize, hasMore, moreOption } = buildPackageMenuPage(packageList, currentPage)
          const num = parseInt(input, 10)

          if (hasMore && Number.isFinite(num) && num === moreOption) {
            const nextPage = currentPage + 1
            await sessions.updateSession(sessionId, { packagePage: nextPage })
            const next = buildPackageMenuPage(packageList, nextPage)
            return res.json({
              message: `Select package:\n${next.lines.join("\n")}`,
              reply: true,
            })
          }

          if (!Number.isFinite(num) || num < 1 || num > pageSize) {
            const { lines } = buildPackageMenuPage(packageList, currentPage)
            return res.json({
              message: `Invalid option.\nSelect package:\n${lines.join("\n")}`,
              reply: true,
            })
          }

          const fullIndex = currentPage * PACKAGES_PER_PAGE + (num - 1)
          const chosen = packageList[fullIndex]
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
              message: "Purchase cancelled. Thank you for using Starexpress.",
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
