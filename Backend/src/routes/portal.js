import express from "express"
import { formatPhoneNumber, initiateMoMoPayment } from "../lib/ussdHelpers.js"
import {
  verifyMoolrePaymentWithRetry,
} from "../lib/moolreEmbedPayment.js"
import { checkMoolrePaymentStatus, scheduleUssdPaymentStatusPoll } from "../lib/moolrePaymentStatus.js"
import {
  generateCaptivePaymentReference,
  isCaptivePaymentReference,
  processCaptiveMomoPaymentSuccess,
  saveCaptivePaymentPending,
} from "../lib/captiveMomoPayment.js"
import { resolvePackageForLocation } from "../lib/packageOverrides.js"
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
 * }} deps
 */
export function createPortalRouter(deps) {
  const { locations, packages, vouchers, sales, auditLogs, agentPaymentPending } = deps
  const router = express.Router()

  /**
   * Same backup pattern as USSD: after Moolre creates the POS payment link, the backend
   * checks payment status on a delay and fulfills the voucher sale even if the POS page
   * never redirects or the browser is closed.
   * @param {string} paymentReference
   */
  function scheduleCaptivePaymentStatusPoll(paymentReference) {
    scheduleUssdPaymentStatusPoll(paymentReference, async (ref) => {
      const existingSale = await sales.findOne({ paymentReference: ref })
      if (existingSale) {
        console.log("[captive-momo] poll idempotent sale exists", {
          paymentReference: ref,
          saleId: existingSale._id,
        })
        return true
      }

      const status = await checkMoolrePaymentStatus(ref)
      console.log("[captive-momo] backup poll result", {
        paymentReference: ref,
        ok: status.ok,
        isPaid: status.isPaid,
        txStatusNum: status.txStatusNum,
        code: status.code,
        message: status.message || status.error,
      })

      if (!status.ok || !status.isPaid) return false

      const outcome = await processCaptiveMomoPaymentSuccess({
        pending: agentPaymentPending,
        packages,
        vouchers,
        sales,
        auditLogs,
        paymentReference: ref,
        source: "backup-poll",
      })
      return outcome.ok === true
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
      res.json({
        locationId,
        locationName: typeof loc.name === "string" ? loc.name : locationId,
        packages: items,
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

      if (!locationId) return res.status(400).json({ error: "locationId is required." })
      if (!packageId) return res.status(400).json({ error: "packageId is required." })

      const phoneDigits = customerPhone.replace(/\D/g, "")
      if (customerPhone.length < 7 || customerPhone.length > 32 || phoneDigits.length < 7) {
        return res.status(400).json({ error: "Customer phone must be valid (at least 7 digits)." })
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
        amount: priceGHS,
      })

      const init = await initiateMoMoPayment(customerPhone, priceGHS, paymentReference, {
        packageName: resolved.name || "WiFi package",
        reference: paymentReference,
        network: undefined,
        moolreNetwork: null,
      })

      if (!init.success) {
        await agentPaymentPending.deleteOne({ _id: paymentReference }).catch(() => {})
        return res.status(400).json({ error: init.message || "Failed to send MoMo prompt." })
      }

      console.log("[captive-momo] init ok", {
        paymentReference,
        packageId,
        locationId,
        amount: priceGHS,
        mode: "direct-debit",
        moolreCode: init.moolreCode,
      })

      scheduleCaptivePaymentStatusPoll(paymentReference)

      res.json({
        success: true,
        data: {
          authorization_url: null,
          reference: paymentReference,
          redirect_url: null,
          amount: priceGHS,
          message: init.message || "Payment prompt sent. Enter your MoMo PIN to approve.",
          mode: "direct_debit",
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
        const sms = await ensureSaleVoucherSmsSent({
          sale: existingSale,
          packages,
          sales,
          source: "portal-complete-idempotent",
        })
        return res.json({
          success: true,
          voucherCode: String(existingSale.voucherCode || ""),
          packageName:
            typeof existingSale.packageType === "string" && existingSale.packageType.trim()
              ? existingSale.packageType.trim()
              : "WiFi",
          smsSent: sms.smsSent === true,
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
      console.log("[captive-momo] status check", {
        paymentReference,
        saleExists: Boolean(sale),
      })

      if (!sale) {
        const status = await checkMoolrePaymentStatus(paymentReference)
        console.log("[captive-momo] status poll result", {
          paymentReference,
          ok: status.ok,
          isPaid: status.isPaid,
          txStatusNum: status.txStatusNum,
          code: status.code,
          message: status.message || status.error,
        })
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
