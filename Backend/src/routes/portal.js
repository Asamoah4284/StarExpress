import express from "express"
import { formatPhoneNumber } from "../lib/ussdHelpers.js"
import {
  billingEmailFromPhone,
  initializeMoolreEmbedLink,
  verifyMoolrePaymentWithRetry,
} from "../lib/moolreEmbedPayment.js"
import { checkMoolrePaymentStatus } from "../lib/moolrePaymentStatus.js"
import {
  generateCaptivePaymentReference,
  isCaptivePaymentReference,
  processCaptiveMomoPaymentSuccess,
  saveCaptivePaymentPending,
} from "../lib/captiveMomoPayment.js"
import { resolvePackageForLocation } from "../lib/packageOverrides.js"
import { getAppSettings } from "../lib/appSettings.js"
import { applyPercentOff, normalizePercentOff } from "../lib/promoDiscount.js"
import { getLocationsWithStock, getPackagesForLocation } from "../services/portalCatalog.js"
import { findRecentVouchersForPhone } from "../services/voucherRetrieve.js"
import { buildPackageAvailabilityFilter } from "../services/voucherSaleFulfillment.js"
import { ensureSaleVoucherSmsSent } from "../lib/saleVoucherSms.js"

/**
 * @param {{
 *   locations: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   agentPaymentPending: import("mongodb").Collection
 *   appSettings: import("mongodb").Collection
 * }} deps
 */
export function createPortalRouter(deps) {
  const { locations, packages, vouchers, sales, auditLogs, agentPaymentPending, appSettings } = deps
  const router = express.Router()

  /**
   * The promo a buyer should see for a location, or null. Gated by the global
   * "show promos" setting AND the location's own active flag + a non-empty code.
   * @param {import("mongodb").Document} loc
   */
  async function getVisiblePromoForLocation(loc) {
    const promo = loc?.promo
    if (!promo || typeof promo !== "object" || promo.active !== true) return null
    const code = typeof promo.code === "string" ? promo.code.trim() : ""
    if (!code) return null
    try {
      const settings = await getAppSettings(appSettings)
      if (!settings.promosVisible) return null
    } catch {
      return null
    }
    return {
      code,
      message: typeof promo.message === "string" ? promo.message.trim() : "",
      percentOff: normalizePercentOff(promo.percentOff),
    }
  }

  /**
   * Validate a buyer-submitted promo code against a location's active promo (same
   * global + per-location gating as the banner). Returns the canonical code + percent
   * to apply, or null if it doesn't match / isn't active. Case-insensitive.
   * @param {import("mongodb").Document} loc
   * @param {string} submittedCode
   */
  async function resolveAppliedPromo(loc, submittedCode) {
    const submitted = String(submittedCode || "").trim()
    if (!submitted) return null
    const promo = loc?.promo
    if (!promo || typeof promo !== "object" || promo.active !== true) return null
    const code = typeof promo.code === "string" ? promo.code.trim() : ""
    if (!code || code.toLowerCase() !== submitted.toLowerCase()) return null
    try {
      const settings = await getAppSettings(appSettings)
      if (!settings.promosVisible) return null
    } catch {
      return null
    }
    return { code, percentOff: normalizePercentOff(promo.percentOff) }
  }

  /**
   * @param {import("mongodb").Document} sale
   * @param {string} source
   */
  function queueVoucherSms(sale, source) {
    if (sale?.smsSent === true) return
    void ensureSaleVoucherSmsSent({ sale, packages, sales, source }).catch((err) => {
      console.error(`[portal] ${source} background SMS failed`, err)
    })
  }

  router.get("/locations", async (_req, res) => {
    try {
      const items = await getLocationsWithStock(locations, vouchers)
      res.json({ locations: items })
    } catch (err) {
      console.error("[portal] GET /locations", err)
      res.status(500).json({ error: "Failed to load locations." })
    }
  })

  router.get("/packages", async (req, res) => {
    try {
      const locationId = typeof req.query?.locationId === "string" ? req.query.locationId.trim() : ""
      if (!locationId) {
        return res.status(400).json({ error: "locationId is required." })
      }
      const loc = await locations.findOne({ _id: locationId })
      if (!loc) return res.status(404).json({ error: "Unknown location." })
      const items = await getPackagesForLocation(packages, vouchers, locationId)
      const promo = await getVisiblePromoForLocation(loc)
      res.json({
        locationId,
        locationName: typeof loc.name === "string" ? loc.name : locationId,
        packages: items,
        promo,
      })
    } catch (err) {
      console.error("[portal] GET /packages", err)
      res.status(500).json({ error: "Failed to load packages." })
    }
  })

  router.post("/payments/initialize", async (req, res) => {
    try {
      const customerPhoneRaw = typeof req.body?.customerPhone === "string" ? req.body.customerPhone.trim() : ""
      const customerPhone = customerPhoneRaw.replace(/\s+/g, " ")
      const packageId = typeof req.body?.packageId === "string" ? req.body.packageId.trim() : ""
      const locationId = typeof req.body?.locationId === "string" ? req.body.locationId.trim() : ""
      const promoCodeRaw = typeof req.body?.promoCode === "string" ? req.body.promoCode.trim().slice(0, 64) : ""

      if (!locationId) return res.status(400).json({ error: "locationId is required." })
      if (!packageId) return res.status(400).json({ error: "packageId is required." })

      const phoneDigits = customerPhone.replace(/\D/g, "")
      if (customerPhone.length < 7 || customerPhone.length > 32 || phoneDigits.length < 7) {
        return res.status(400).json({ error: "Customer phone must be valid (at least 7 digits)." })
      }

      const billingEmail = billingEmailFromPhone(customerPhone)
      if (!billingEmail) {
        return res.status(400).json({ error: "A valid customer phone is required to start MoMo payment." })
      }

      const loc = await locations.findOne({ _id: locationId })
      if (!loc) return res.status(400).json({ error: "Unknown location." })

      const pkg = await packages.findOne({ _id: packageId })
      if (!pkg) return res.status(400).json({ error: "Unknown package." })

      const resolved = resolvePackageForLocation(pkg, locationId)
      if (resolved.status !== "Active") {
        return res.status(400).json({ error: "Only active packages can be purchased." })
      }
      const priceGHS = resolved.priceGHS
      if (!Number.isFinite(priceGHS) || priceGHS <= 0) {
        return res.status(400).json({ error: "Invalid package price." })
      }

      // Apply a promo discount on the backend (authoritative). The client only previews the
      // discounted price; the real charge is computed here.
      let amount = priceGHS
      let appliedPromo = /** @type {{ code: string, percentOff: number } | null} */ (null)
      if (promoCodeRaw) {
        const applied = await resolveAppliedPromo(loc, promoCodeRaw)
        if (!applied) {
          return res.status(400).json({ error: "That promo code isn't valid for this location." })
        }
        amount = applyPercentOff(priceGHS, applied.percentOff)
        if (applied.percentOff > 0) appliedPromo = applied
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return res
          .status(400)
          .json({ error: "Discounted total is too low to charge online. Please contact the store." })
      }

      const availFilter = buildPackageAvailabilityFilter(packageId, locationId)
      const available = await vouchers.findOne(availFilter, { projection: { _id: 1 } })
      if (!available) {
        return res.status(400).json({ error: "No vouchers available for this package at this wifi location." })
      }

      const paymentReference = generateCaptivePaymentReference()
      await saveCaptivePaymentPending(agentPaymentPending, {
        paymentReference,
        customerPhone,
        packageId,
        locationId,
        amount,
        basePrice: priceGHS,
        promoCode: appliedPromo?.code ?? null,
        promoPercentOff: appliedPromo?.percentOff ?? 0,
      })

      // Use the shared backend redirect page (same as agent sales). That page posts a
      // `moolre-payment-success` message to the parent window so the embedded iframe can
      // detect success reliably, and it also reconciles captive payments server-side.
      const init = await initializeMoolreEmbedLink({
        amount,
        email: billingEmail,
        externalref: paymentReference,
        metadata: {
          packageId,
          locationId,
          orderType: "captive_sale",
          ...(appliedPromo ? { promoCode: appliedPromo.code, promoPercentOff: appliedPromo.percentOff } : {}),
        },
      })

      if (!init.ok) {
        await agentPaymentPending.deleteOne({ _id: paymentReference }).catch(() => {})
        return res.status(400).json({ error: init.error || "Failed to initialize payment." })
      }

      console.log("[captive-momo] init ok", {
        paymentReference,
        packageId,
        locationId,
        amount,
        basePrice: priceGHS,
        promoCode: appliedPromo?.code,
        promoPercentOff: appliedPromo?.percentOff,
        redirectUrl: init.redirect_url,
      })

      res.json({
        success: true,
        data: {
          authorization_url: init.authorization_url,
          reference: paymentReference,
          redirect_url: init.redirect_url,
          amount,
          originalAmount: priceGHS,
          ...(appliedPromo
            ? { promoCode: appliedPromo.code, promoPercentOff: appliedPromo.percentOff }
            : {}),
        },
      })
    } catch (err) {
      console.error("[portal] POST /payments/initialize", err)
      res.status(500).json({ error: "Failed to initialize payment." })
    }
  })

  router.post("/payments/complete", async (req, res) => {
    try {
      const paymentReference =
        typeof req.body?.paymentReference === "string" ? req.body.paymentReference.trim() : ""
      if (!paymentReference) {
        return res.status(400).json({ error: "paymentReference is required." })
      }
      if (!isCaptivePaymentReference(paymentReference)) {
        return res.status(400).json({ error: "Invalid payment reference." })
      }

      let existingSale = await sales.findOne({ paymentReference })
      if (existingSale) {
        queueVoucherSms(existingSale, "portal-complete-idempotent")
        return res.json({
          success: true,
          voucherCode: String(existingSale.voucherCode || ""),
          packageName:
            typeof existingSale.packageType === "string" && existingSale.packageType.trim()
              ? existingSale.packageType.trim()
              : "WiFi",
          smsSent: existingSale.smsSent === true,
          paymentReference,
          idempotent: true,
        })
      }

      const verified = await verifyMoolrePaymentWithRetry(paymentReference)
      if (!verified.ok) {
        return res.status(400).json({ error: verified.error || "Payment not verified." })
      }

      const outcome = await processCaptiveMomoPaymentSuccess({
        pending: agentPaymentPending,
        packages,
        vouchers,
        sales,
        auditLogs,
        paymentReference,
        source: "portal-complete",
      })

      if (!outcome.ok) {
        const retryable = outcome.status === "no_pending" || outcome.status === "no_stock"
        const msg =
          outcome.status === "no_pending"
            ? "Payment is still processing. Please wait and try again."
            : outcome.status === "no_stock"
              ? "No vouchers available. Contact support for a refund."
              : "Could not complete your purchase. Please contact support."
        return res.status(retryable ? 409 : 400).json({ error: msg })
      }

      existingSale = await sales.findOne({ paymentReference })
      res.json({
        success: true,
        voucherCode: String(outcome.voucherCode || existingSale?.voucherCode || ""),
        packageName:
          typeof existingSale?.packageType === "string" && existingSale.packageType.trim()
            ? existingSale.packageType.trim()
            : "WiFi",
        smsSent: outcome.smsSent === true,
        paymentReference,
      })
    } catch (err) {
      console.error("[portal] POST /payments/complete", err)
      res.status(500).json({ error: "Failed to complete payment." })
    }
  })

  // Lightweight poll used by the buy page while the Moolre POS iframe is open. Returns the
  // fulfilled sale's voucher the moment it exists (via webhook) or, if not yet fulfilled, does a
  // single quick Moolre status check and fulfills — so a stuck/timed-out POS page never blocks
  // the customer from getting their code.
  router.get("/payments/status", async (req, res) => {
    try {
      const paymentReference =
        typeof req.query?.paymentReference === "string" ? req.query.paymentReference.trim() : ""
      if (!paymentReference || !isCaptivePaymentReference(paymentReference)) {
        return res.status(400).json({ error: "Valid paymentReference is required." })
      }

      let sale = await sales.findOne({ paymentReference })

      if (!sale) {
        const status = await checkMoolrePaymentStatus(paymentReference)
        if (status.ok && status.isPaid) {
          await processCaptiveMomoPaymentSuccess({
            pending: agentPaymentPending,
            packages,
            vouchers,
            sales,
            auditLogs,
            paymentReference,
            source: "portal-status",
          })
          sale = await sales.findOne({ paymentReference })
        }
      }

      if (!sale) {
        return res.json({ ready: false })
      }
      queueVoucherSms(sale, "portal-status-idempotent")

      return res.json({
        ready: true,
        voucherCode: String(sale.voucherCode || ""),
        packageName:
          typeof sale.packageType === "string" && sale.packageType.trim()
            ? sale.packageType.trim()
            : "WiFi",
        smsSent: sale.smsSent === true,
      })
    } catch (err) {
      console.error("[portal] GET /payments/status", err)
      res.status(500).json({ error: "Failed to check status." })
    }
  })

  router.post("/vouchers/retrieve", async (req, res) => {
    try {
      const phoneRaw = typeof req.body?.phone === "string" ? req.body.phone.trim() : ""
      if (!phoneRaw) return res.status(400).json({ error: "phone is required." })

      const formatted = formatPhoneNumber(phoneRaw)
      if (!formatted) {
        return res.status(400).json({ error: "Enter a valid phone number." })
      }

      const items = await findRecentVouchersForPhone(sales, formatted)
      if (items.length === 0) {
        return res.json({
          vouchers: [],
          message:
            "No vouchers found for this number. If you just paid, wait a moment and try again, or contact support.",
        })
      }

      res.json({ vouchers: items })
    } catch (err) {
      console.error("[portal] POST /vouchers/retrieve", err)
      res.status(500).json({ error: "Failed to retrieve vouchers." })
    }
  })

  return router
}
