import express from "express"
import {
  billingEmailFromPhone,
  initializeMoolreEmbedLink,
  verifyMoolrePaymentWithRetry,
} from "../lib/moolreEmbedPayment.js"
import { checkMoolrePaymentStatus } from "../lib/moolrePaymentStatus.js"
import {
  generateCaptivePaymentReference,
  hasCaptivePortalAuthParams,
  isCaptivePaymentReference,
  normalizeCaptivePortalParams,
  processCaptiveMomoPaymentSuccess,
  saveCaptivePaymentPending,
} from "../lib/captiveMomoPayment.js"
import { resolvePackageForLocation } from "../lib/packageOverrides.js"
import { getAppSettings } from "../lib/appSettings.js"
import { applyPercentOff, normalizePercentOff } from "../lib/promoDiscount.js"
import { generateRadiusSession, isRadiusConfigured } from "../lib/radiusAuth.js"
import { getPortalLocations, getPortalPackagesForLocation } from "../services/portalCatalog.js"
import { formatPhoneNumber } from "../lib/ussdHelpers.js"
import { findRecentVouchersForPhone } from "../services/voucherRetrieve.js"

/**
 * Captive portal (/buy) — FreeRADIUS automatic authentication only.
 * No voucher codes, voucher SMS, or voucher UI for this channel.
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
  const { locations, packages, sales, auditLogs, agentPaymentPending, appSettings } = deps
  const router = express.Router()

  /**
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

  router.get("/locations", async (_req, res) => {
    try {
      const items = await getPortalLocations(locations)
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
      const items = await getPortalPackagesForLocation(packages, locationId)
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
      const portalParams = normalizeCaptivePortalParams(req.body)

      console.log("[portal] initialize portal params", {
        login_url: portalParams.login_url,
        ap_mac: portalParams.ap_mac,
        client_mac: portalParams.client_mac,
        orig_url: portalParams.orig_url,
        ssid: portalParams.ssid,
      })

      if (!hasCaptivePortalAuthParams(portalParams)) {
        return res.status(400).json({
          error:
            "Missing captive portal session (login_url / client_mac). Connect through the WiFi hotspot splash page to buy access.",
        })
      }

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
        portalParams,
      })

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
        client_mac: portalParams.client_mac,
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
        return res.json({
          success: true,
          packageName:
            typeof existingSale.packageType === "string" && existingSale.packageType.trim()
              ? existingSale.packageType.trim()
              : "WiFi",
          paymentReference,
          hotspot: true,
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
        sales,
        auditLogs,
        paymentReference,
        source: "portal-complete",
      })

      if (!outcome.ok) {
        const retryable = outcome.status === "no_pending"
        const msg =
          outcome.status === "no_pending"
            ? "Payment is still processing. Please wait and try again."
            : outcome.status === "missing_portal_params"
              ? "Missing captive portal session data. Reconnect to WiFi and try again from the hotspot splash page."
              : "Could not complete your purchase. Please contact support."
        return res.status(retryable ? 409 : 400).json({ error: msg })
      }

      existingSale = await sales.findOne({ paymentReference })
      res.json({
        success: true,
        packageName:
          typeof existingSale?.packageType === "string" && existingSale.packageType.trim()
            ? existingSale.packageType.trim()
            : "WiFi",
        paymentReference,
        hotspot: true,
      })
    } catch (err) {
      console.error("[portal] POST /payments/complete", err)
      res.status(500).json({ error: "Failed to complete payment." })
    }
  })

  // Poll while the Moolre POS iframe is open — ready once the RADIUS sale record exists.
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
        packageName:
          typeof sale.packageType === "string" && sale.packageType.trim()
            ? sale.packageType.trim()
            : "WiFi",
        hotspot: true,
      })
    } catch (err) {
      console.error("[portal] GET /payments/status", err)
      res.status(500).json({ error: "Failed to check status." })
    }
  })

  /**
   * After MoMo success: write FreeRADIUS credentials and return Grandstream authorizeUrl.
   * This is the only successful outcome for captive purchases — never falls back to vouchers.
   */
  router.post("/payments/radius-authorize", async (req, res) => {
    try {
      const paymentReference =
        typeof req.body?.paymentReference === "string" ? req.body.paymentReference.trim() : ""
      if (!paymentReference) {
        return res.status(400).json({ error: "paymentReference is required." })
      }
      if (!isCaptivePaymentReference(paymentReference)) {
        return res.status(400).json({ error: "Invalid payment reference." })
      }

      const sale = await sales.findOne({ paymentReference })
      if (!sale) {
        return res.status(409).json({ error: "Payment is not complete yet. Wait a moment and try again." })
      }

      const pendingDoc = await agentPaymentPending.findOne({ _id: paymentReference })
      const fromSale = normalizeCaptivePortalParams(sale.portalParams || sale)
      const fromPending = normalizeCaptivePortalParams(pendingDoc?.portalParams || pendingDoc)
      const fromBody = normalizeCaptivePortalParams(req.body)
      const portalParams = {
        login_url: fromSale.login_url || fromPending.login_url || fromBody.login_url,
        ap_mac: fromSale.ap_mac || fromPending.ap_mac || fromBody.ap_mac,
        client_mac: fromSale.client_mac || fromPending.client_mac || fromBody.client_mac,
        orig_url: fromSale.orig_url || fromPending.orig_url || fromBody.orig_url,
        ssid: fromSale.ssid || fromPending.ssid || fromBody.ssid,
      }

      console.log("[portal] radius-authorize params", {
        paymentReference,
        hasLoginUrl: Boolean(portalParams.login_url),
        client_mac: portalParams.client_mac || "",
        source: fromSale.login_url
          ? "sale"
          : fromPending.login_url
            ? "pending"
            : fromBody.login_url
              ? "body"
              : "none",
      })

      if (!hasCaptivePortalAuthParams(portalParams)) {
        console.error("[portal] radius-authorize missing login_url/client_mac", { paymentReference })
        return res.status(400).json({
          error:
            "Missing captive portal session (login_url / client_mac). Reconnect to the WiFi hotspot and buy again from the splash page.",
        })
      }

      await agentPaymentPending.updateOne(
        { _id: paymentReference },
        { $set: { portalParams, fulfillmentMode: "radius" } },
      )
      await sales.updateOne(
        { paymentReference },
        { $set: { portalParams, fulfillmentMode: "radius" } },
      )

      if (typeof pendingDoc?.radiusAuthorizeUrl === "string" && pendingDoc.radiusAuthorizeUrl.trim()) {
        console.log("[portal] authorizeUrl", pendingDoc.radiusAuthorizeUrl.trim())
        return res.json({
          success: true,
          hotspot: true,
          authorizeUrl: pendingDoc.radiusAuthorizeUrl.trim(),
          username: typeof pendingDoc.radiusUsername === "string" ? pendingDoc.radiusUsername : "",
          paymentReference,
          idempotent: true,
        })
      }

      if (!isRadiusConfigured()) {
        console.error("[portal] RADIUS DB not configured", { paymentReference })
        return res.status(503).json({
          error:
            "WiFi authorization is temporarily unavailable (RADIUS database not configured). Please contact support — your payment was received.",
        })
      }

      const packageId = String(sale.packageId || pendingDoc?.packageId || "").trim()
      const pkg = packageId ? await packages.findOne({ _id: packageId }) : null

      let session
      try {
        console.log("[portal] portalParams", portalParams)
        console.log("[portal] generating radius session")

        session = await generateRadiusSession(portalParams, packageId, pkg)

        console.log("[portal] radius session created", session.username)
        console.log("[portal] authorizeUrl", session.authorizeUrl)
      } catch (err) {
        console.error("[portal] RADIUS session failed", {
          paymentReference,
          error: err instanceof Error ? err.message : err,
        })
        return res.status(500).json({
          error: `Could not authorize WiFi access: ${err instanceof Error ? err.message : "RADIUS write failed"}. Please contact support — your payment was received.`,
        })
      }

      await agentPaymentPending.updateOne(
        { _id: paymentReference },
        {
          $set: {
            radiusUsername: session.username,
            radiusAuthorizeUrl: session.authorizeUrl,
            radiusAuthorizedAt: new Date().toISOString(),
            portalParams,
            fulfillmentMode: "radius",
          },
        },
      )
      await sales.updateOne(
        { paymentReference },
        {
          $set: {
            radiusUsername: session.username,
            radiusAuthorizedAt: new Date().toISOString(),
            portalParams,
            fulfillmentMode: "radius",
          },
        },
      )

      console.log("[portal] RADIUS authorize ok", {
        paymentReference,
        username: session.username,
        sessionTimeout: session.sessionTimeout,
        maxOctets: session.maxOctets,
      })

      return res.json({
        success: true,
        hotspot: true,
        authorizeUrl: session.authorizeUrl,
        username: session.username,
        paymentReference,
      })
    } catch (err) {
      console.error("[portal] POST /payments/radius-authorize", err)
      res.status(500).json({ error: "Failed to authorize WiFi access." })
    }
  })

  /**
   * Legacy / agent-sold voucher lookup (not used by FreeRADIUS captive purchases).
   */
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
            "No vouchers found for this number. If you bought WiFi on this hotspot, access is granted automatically after payment — reconnect to the network.",
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
