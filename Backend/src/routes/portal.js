import express from "express"
import {
  billingEmailFromPhone,
  initializeMoolreEmbedLink,
  verifyMoolrePaymentWithRetry,
} from "../lib/moolreEmbedPayment.js"
import { checkMoolrePaymentStatus } from "../lib/moolrePaymentStatus.js"
import {
  generateCaptivePaymentReference,
  isCaptivePaymentReference,
  normalizeCaptivePortalParams,
  processCaptiveMomoPaymentSuccess,
  saveCaptivePaymentPending,
  wifiCodeFromSale,
  buildHotspotAuthorizeUrl,
} from "../lib/captiveMomoPayment.js"
import { resolvePackageForLocation } from "../lib/packageOverrides.js"
import { getAppSettings, resolvePublicEnquiryPhone } from "../lib/appSettings.js"
import { applyPercentOff, normalizePercentOff } from "../lib/promoDiscount.js"
import { resolvePortalOrgId } from "../lib/organizations.js"
import { getPortalLocations, getPackagesForLocation } from "../services/portalCatalog.js"
import { buildPackageAvailabilityFilter } from "../services/voucherSaleFulfillment.js"
import { formatPhoneNumber } from "../lib/ussdHelpers.js"
import { findRecentVouchersForPhone } from "../services/voucherRetrieve.js"
import { buyLog, buyError, maskPhoneForLog, errorForLog } from "../lib/buyLog.js"

/**
 * Captive portal (/buy) — sells uploaded daloRADIUS voucher codes.
 * After MoMo, one unused CSV voucher is marked used and SMS'd as a single code.
 *
 * @param {{
 *   locations: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers?: import("mongodb").Collection
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
   * @param {import("mongodb").Document | null | undefined} sale
   * @param {Record<string, unknown>} [extra]
   */
  function captiveSalePayload(sale, extra = {}) {
    const portal = normalizeCaptivePortalParams(sale?.portalParams)
    const voucherCode =
      (typeof extra.voucherCode === "string" && extra.voucherCode.trim()) ||
      (typeof sale?.voucherCode === "string" && sale.voucherCode.trim()) ||
      (typeof sale?.radiusUsername === "string" && sale.radiusUsername.trim()) ||
      ""
    const payload = {
      success: true,
      packageName:
        typeof sale?.packageType === "string" && sale.packageType.trim()
          ? sale.packageType.trim()
          : "WiFi",
      voucherCode,
      smsSent: sale?.smsSent === true,
      hotspot: true,
      login_url: portal.login_url,
      ap_mac: portal.ap_mac,
      client_mac: portal.client_mac,
      orig_url: portal.orig_url,
      ssid: portal.ssid,
      ...extra,
    }
    payload.voucherCode = String(payload.voucherCode || "").trim()
    payload.authorizeUrl =
      buildHotspotAuthorizeUrl(payload.login_url, payload.voucherCode, {
        orig_url: payload.orig_url,
      }) || null
    return payload
  }

  /**
   * @param {import("mongodb").Document} loc
   */
  async function getVisiblePromoForLocation(loc) {
    const promo = loc?.promo
    if (!promo || typeof promo !== "object" || promo.active !== true) return null
    const code = typeof promo.code === "string" ? promo.code.trim() : ""
    if (!code) return null
    try {
      const orgId = typeof loc?.orgId === "string" ? loc.orgId : undefined
      const settings = await getAppSettings(appSettings, orgId)
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
      const orgId = typeof loc?.orgId === "string" ? loc.orgId : undefined
      const settings = await getAppSettings(appSettings, orgId)
      if (!settings.promosVisible) return null
    } catch {
      return null
    }
    return { code, percentOff: normalizePercentOff(promo.percentOff) }
  }

  /**
   * @param {import("express").Request} req
   */
  function readPortalOrgParam(req) {
    const queryOrg = typeof req.query?.org === "string" ? req.query.org.trim() : ""
    const queryOrgId = typeof req.query?.orgId === "string" ? req.query.orgId.trim() : ""
    const bodyOrg = typeof req.body?.org === "string" ? req.body.org.trim() : ""
    const bodyOrgId = typeof req.body?.orgId === "string" ? req.body.orgId.trim() : ""
    return queryOrg || queryOrgId || bodyOrg || bodyOrgId
  }

  router.get("/locations", async (req, res) => {
    try {
      const orgId = resolvePortalOrgId(readPortalOrgParam(req))
      const items = await getPortalLocations(locations, { orgId })
      let enquiryPhone = ""
      try {
        const settings = await getAppSettings(appSettings, orgId)
        enquiryPhone = resolvePublicEnquiryPhone(settings)
      } catch {
        enquiryPhone = ""
      }
      res.json({ locations: items, org: orgId, enquiryPhone })
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
      const orgId = resolvePortalOrgId(readPortalOrgParam(req))
      const loc = await locations.findOne({ _id: locationId, orgId })
      if (!loc) return res.status(404).json({ error: "Unknown location." })
      const locOrgId = resolvePortalOrgId(typeof loc.orgId === "string" ? loc.orgId : orgId)
      if (!vouchers) return res.status(503).json({ error: "Voucher stock is unavailable." })
      const items = await getPackagesForLocation(packages, vouchers, locationId, { orgId: locOrgId })
      const promo = await getVisiblePromoForLocation(loc)
      res.json({
        locationId,
        locationName: typeof loc.name === "string" ? loc.name : locationId,
        packages: items,
        promo,
        org: locOrgId,
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
      const portalParams = normalizeCaptivePortalParams(req.body)

      buyLog("initialize start", {
        locationId,
        packageId,
        promoCode: promoCodeRaw || null,
        phone: maskPhoneForLog(customerPhone),
        portalParams,
      })

      if (!vouchers) {
        buyError("initialize abort", { reason: "vouchers collection missing" })
        return res.status(503).json({
          error: "WiFi codes are temporarily unavailable. Please try again later.",
        })
      }

      if (!locationId) {
        buyError("initialize abort", { reason: "locationId required" })
        return res.status(400).json({ error: "locationId is required." })
      }
      if (!packageId) {
        buyError("initialize abort", { reason: "packageId required" })
        return res.status(400).json({ error: "packageId is required." })
      }

      const phoneDigits = customerPhone.replace(/\D/g, "")
      if (customerPhone.length < 7 || customerPhone.length > 32 || phoneDigits.length < 7) {
        buyError("initialize abort", { reason: "invalid phone", phone: maskPhoneForLog(customerPhone) })
        return res.status(400).json({ error: "Customer phone must be valid (at least 7 digits)." })
      }

      const billingEmail = billingEmailFromPhone(customerPhone)
      if (!billingEmail) {
        buyError("initialize abort", { reason: "billing email from phone failed" })
        return res.status(400).json({ error: "A valid customer phone is required to start MoMo payment." })
      }

      const orgId = resolvePortalOrgId(readPortalOrgParam(req))
      const loc = await locations.findOne({ _id: locationId, orgId })
      if (!loc) {
        buyError("initialize abort", { reason: "unknown location", locationId, orgId })
        return res.status(400).json({ error: "Unknown location." })
      }
      const locOrgId = resolvePortalOrgId(typeof loc.orgId === "string" ? loc.orgId : orgId)
      buyLog("initialize location", { locationId, name: loc.name, orgId: locOrgId })

      const pkg = await packages.findOne({ _id: packageId, orgId: locOrgId })
      if (!pkg) {
        buyError("initialize abort", { reason: "unknown package", packageId, orgId: locOrgId })
        return res.status(400).json({ error: "Unknown package." })
      }

      const resolved = resolvePackageForLocation(pkg, locationId)
      buyLog("initialize package", {
        packageId,
        name: resolved.name,
        status: resolved.status,
        priceGHS: resolved.priceGHS,
        dataLimit: resolved.dataLimit,
      })
      if (resolved.status !== "Active") {
        buyError("initialize abort", { reason: "package inactive", packageId })
        return res.status(400).json({ error: "Only active packages can be purchased." })
      }
      const priceGHS = resolved.priceGHS
      if (!Number.isFinite(priceGHS) || priceGHS <= 0) {
        buyError("initialize abort", { reason: "invalid price", priceGHS })
        return res.status(400).json({ error: "Invalid package price." })
      }

      const remaining = await vouchers.countDocuments({
        ...buildPackageAvailabilityFilter(packageId, locationId),
        ...(locOrgId ? { orgId: locOrgId } : {}),
      })
      buyLog("initialize stock", { packageId, locationId, remaining })
      if (remaining <= 0) {
        buyError("initialize abort", { reason: "out of stock", packageId, locationId })
        return res.status(400).json({
          error: "This package is out of WiFi codes at this location. Please pick another package or try again later.",
        })
      }

      let amount = priceGHS
      let appliedPromo = /** @type {{ code: string, percentOff: number } | null} */ (null)
      if (promoCodeRaw) {
        const applied = await resolveAppliedPromo(loc, promoCodeRaw)
        if (!applied) {
          buyError("initialize abort", { reason: "invalid promo", promoCode: promoCodeRaw })
          return res.status(400).json({ error: "That promo code isn't valid for this location." })
        }
        amount = applyPercentOff(priceGHS, applied.percentOff)
        if (applied.percentOff > 0) appliedPromo = applied
        buyLog("initialize promo", appliedPromo)
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        buyError("initialize abort", { reason: "discounted total too low", amount })
        return res
          .status(400)
          .json({ error: "Discounted total is too low to charge online. Please contact the store." })
      }

      const paymentReference = generateCaptivePaymentReference()
      buyLog("initialize pending save", { paymentReference, amount, basePrice: priceGHS })
      await saveCaptivePaymentPending(agentPaymentPending, {
        paymentReference,
        customerPhone,
        packageId,
        locationId,
        ...(locOrgId ? { orgId: locOrgId } : {}),
        amount,
        basePrice: priceGHS,
        promoCode: appliedPromo?.code ?? null,
        promoPercentOff: appliedPromo?.percentOff ?? 0,
        portalParams,
      })

      buyLog("initialize moolre start", { paymentReference, amount })
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
        buyError("initialize moolre failed", { paymentReference, error: init.error })
        await agentPaymentPending.deleteOne({ _id: paymentReference }).catch(() => {})
        return res.status(400).json({ error: init.error || "Failed to initialize payment." })
      }

      buyLog("initialize ok", {
        paymentReference,
        packageId,
        locationId,
        amount,
        remaining,
        hasAuthorizationUrl: Boolean(init.authorization_url),
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
      buyError("initialize exception", errorForLog(err))
      console.error("[portal] POST /payments/initialize", err)
      res.status(500).json({ error: "Failed to initialize payment." })
    }
  })

  router.post("/payments/complete", async (req, res) => {
    try {
      const paymentReference =
        typeof req.body?.paymentReference === "string" ? req.body.paymentReference.trim() : ""
      buyLog("complete start", { paymentReference })
      if (!paymentReference) {
        buyError("complete abort", { reason: "missing paymentReference" })
        return res.status(400).json({ error: "paymentReference is required." })
      }
      if (!isCaptivePaymentReference(paymentReference)) {
        buyError("complete abort", { reason: "invalid paymentReference", paymentReference })
        return res.status(400).json({ error: "Invalid payment reference." })
      }

      const existingSale = await sales.findOne({ paymentReference })
      if (existingSale && wifiCodeFromSale(existingSale)) {
        const code = wifiCodeFromSale(existingSale)
        buyLog("complete already fulfilled", {
          paymentReference,
          saleId: existingSale._id,
          voucherCode: code,
          smsSent: existingSale.smsSent === true,
        })
        return res.json(
          captiveSalePayload(existingSale, {
            paymentReference,
            idempotent: true,
          }),
        )
      }

      buyLog("complete verify moolre", { paymentReference })
      const verified = await verifyMoolrePaymentWithRetry(paymentReference)
      buyLog("complete moolre result", {
        paymentReference,
        ok: verified.ok,
        error: verified.ok ? undefined : verified.error,
        amountPaid: verified.ok ? verified.amountPaid : undefined,
      })
      if (!verified.ok) {
        buyError("complete not paid", { paymentReference, error: verified.error })
        return res.status(400).json({ error: verified.error || "Payment not verified." })
      }

      buyLog("complete fulfill", { paymentReference })
      const outcome = await processCaptiveMomoPaymentSuccess({
        pending: agentPaymentPending,
        packages,
        vouchers,
        sales,
        auditLogs,
        paymentReference,
        source: "portal-complete",
      })
      buyLog("complete fulfill outcome", {
        paymentReference,
        ok: outcome.ok,
        status: outcome.status,
        saleId: outcome.saleId,
        voucherCode: outcome.voucherCode,
        smsSent: outcome.smsSent,
      })

      if (!outcome.ok || !outcome.voucherCode) {
        if (
          outcome.status === "out_of_stock" ||
          outcome.status === "voucher_unavailable"
        ) {
          buyError("complete no stock after pay", { paymentReference, status: outcome.status })
          return res.status(409).json({
            error:
              "Payment was received but no WiFi code was in stock. Please contact support with the phone number you paid with.",
          })
        }
        const retryable = outcome.status === "no_pending" || outcome.status === "voucher_failed"
        buyError("complete fulfill incomplete", {
          paymentReference,
          status: outcome.status,
          retryable,
        })
        return res.status(retryable ? 409 : 400).json({
          error: retryable
            ? "Payment was received. Preparing your WiFi code…"
            : "Could not issue your WiFi code. Please contact support with the phone number you paid with.",
        })
      }

      const sale = await sales.findOne({ paymentReference })
      buyLog("complete ok", {
        paymentReference,
        voucherCode: outcome.voucherCode,
        smsSent: outcome.smsSent === true,
      })
      return res.json(
        captiveSalePayload(sale, {
          paymentReference,
          voucherCode: outcome.voucherCode,
          smsSent: outcome.smsSent === true,
        }),
      )
    } catch (err) {
      buyError("complete exception", errorForLog(err))
      console.error("[portal] POST /payments/complete", err)
      res.status(500).json({ error: "Failed to complete payment." })
    }
  })

  /** @type {Map<string, number>} */
  const lastMoolreStatusAt = new Map()
  const MOOLRE_STATUS_MIN_INTERVAL_MS = 8_000

  // Poll while MoMo is open / on the success page — ready once webhook assigned a voucher + SMS.
  router.get("/payments/status", async (req, res) => {
    try {
      const paymentReference =
        typeof req.query?.paymentReference === "string" ? req.query.paymentReference.trim() : ""
      buyLog("status poll", { paymentReference })
      if (!paymentReference || !isCaptivePaymentReference(paymentReference)) {
        buyError("status abort", { reason: "invalid paymentReference", paymentReference })
        return res.status(400).json({ error: "Valid paymentReference is required." })
      }

      let sale = await sales.findOne({ paymentReference })
      buyLog("status sale lookup", {
        paymentReference,
        hasSale: Boolean(sale),
        hasCode: Boolean(wifiCodeFromSale(sale)),
      })
      if (!wifiCodeFromSale(sale)) {
        const now = Date.now()
        const lastAt = lastMoolreStatusAt.get(paymentReference) || 0
        const mayQueryMoolre = now - lastAt >= MOOLRE_STATUS_MIN_INTERVAL_MS
        if (mayQueryMoolre) {
          lastMoolreStatusAt.set(paymentReference, now)
          const paid = await checkMoolrePaymentStatus(paymentReference)
          buyLog("status moolre", {
            paymentReference,
            ok: paid.ok,
            isPaid: paid.isPaid,
            code: paid.code,
            error: paid.ok ? undefined : paid.error,
          })
          if (paid.ok && paid.isPaid) {
            const outcome = await processCaptiveMomoPaymentSuccess({
              pending: agentPaymentPending,
              packages,
              vouchers,
              sales,
              auditLogs,
              paymentReference,
              source: "portal-status",
            })
            buyLog("status fulfill outcome", {
              paymentReference,
              ok: outcome.ok,
              status: outcome.status,
              voucherCode: outcome.voucherCode,
              smsSent: outcome.smsSent,
            })
            sale = await sales.findOne({ paymentReference })
          }
        }
      }

      const code = wifiCodeFromSale(sale)
      if (!sale || !code) {
        buyLog("status not ready", { paymentReference })
        return res.json({ ready: false })
      }

      const payload = captiveSalePayload(sale)
      buyLog("status ready", {
        paymentReference,
        voucherCode: payload.voucherCode,
        smsSent: payload.smsSent,
        hasLoginUrl: Boolean(payload.login_url),
      })
      return res.json({
        ready: true,
        ...payload,
      })
    } catch (err) {
      buyLog("status exception", errorForLog(err))
      console.error("[portal] GET /payments/status", err)
      res.status(500).json({ error: "Failed to check status." })
    }
  })

  /**
   * Legacy auto-connect endpoint. Captive /buy now issues an uploaded voucher
   * at payment time — return that code and never create a new RADIUS user.
   */
  router.post("/payments/radius-authorize", async (req, res) => {
    try {
      const paymentReference =
        typeof req.body?.paymentReference === "string" ? req.body.paymentReference.trim() : ""
      buyLog("radius-authorize start", { paymentReference })
      if (!paymentReference) {
        buyError("radius-authorize abort", { reason: "missing paymentReference" })
        return res.status(400).json({ error: "paymentReference is required." })
      }
      if (!isCaptivePaymentReference(paymentReference)) {
        buyError("radius-authorize abort", { reason: "invalid paymentReference", paymentReference })
        return res.status(400).json({ error: "Invalid payment reference." })
      }

      const sale = await sales.findOne({ paymentReference })
      if (!sale) {
        buyLog("radius-authorize sale not ready", { paymentReference })
        return res.status(409).json({ error: "Payment is not complete yet. Wait a moment and try again." })
      }

      const existingCode = wifiCodeFromSale(sale)
      if (!existingCode) {
        buyError("radius-authorize no code yet", { paymentReference, saleId: sale._id })
        return res.status(409).json({
          error: "Your WiFi code is not ready yet. Wait a moment or check the SMS we sent.",
        })
      }
      const portal = normalizeCaptivePortalParams({
        ...(sale.portalParams && typeof sale.portalParams === "object" ? sale.portalParams : {}),
        ...req.body,
      })
      const authorizeUrl =
        buildHotspotAuthorizeUrl(portal.login_url, existingCode, { orig_url: portal.orig_url }) ||
        null
      buyLog("radius-authorize ok", {
        paymentReference,
        voucherCode: existingCode,
        hasAuthorizeUrl: Boolean(authorizeUrl),
      })
      return res.json({
        success: true,
        hotspot: true,
        authorizeUrl,
        voucherCode: existingCode,
        login_url: portal.login_url,
        ap_mac: portal.ap_mac,
        client_mac: portal.client_mac,
        orig_url: portal.orig_url,
        ssid: portal.ssid,
        paymentReference,
        idempotent: true,
      })
    } catch (err) {
      buyError("radius-authorize exception", errorForLog(err))
      console.error("[portal] POST /payments/radius-authorize", err)
      res.status(500).json({ error: "Failed to authorize WiFi access." })
    }
  })

  /**
   * Lookup recent WiFi codes sold to this phone (captive RADIUS codes, agent, USSD).
   */
  router.post("/vouchers/retrieve", async (req, res) => {
    try {
      const phoneRaw = typeof req.body?.phone === "string" ? req.body.phone.trim() : ""
      buyLog("retrieve start", { phone: maskPhoneForLog(phoneRaw) })
      if (!phoneRaw) return res.status(400).json({ error: "phone is required." })

      const formatted = formatPhoneNumber(phoneRaw)
      if (!formatted) {
        buyError("retrieve invalid phone", { phone: maskPhoneForLog(phoneRaw) })
        return res.status(400).json({ error: "Enter a valid phone number." })
      }

      const items = await findRecentVouchersForPhone(sales, formatted)
      buyLog("retrieve result", {
        phone: maskPhoneForLog(formatted),
        count: items.length,
        codes: items.map((v) => v.voucherCode),
      })
      if (items.length === 0) {
        return res.json({
          vouchers: [],
          message:
            "No WiFi codes found for this number. If you just paid, wait a moment and try again, or check the SMS we sent.",
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
