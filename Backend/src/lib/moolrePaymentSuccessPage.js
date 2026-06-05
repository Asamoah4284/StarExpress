import { checkMoolrePaymentStatus } from "./moolrePaymentStatus.js"
import {
  isAgentPaymentReference,
  markAgentPaymentPendingCompleted,
  processAgentMomoPaymentSuccess,
} from "./agentMomoPayment.js"

/**
 * @param {{
 *   agentPaymentPending: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 * }} deps
 */
export function createMoolrePaymentSuccessHandler(deps) {
  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   */
  return function handleMoolrePaymentSuccessPage(req, res) {
    const q = req.query || {}
    const reference = pickReference(q)

    console.log("[moolre-redirect] payment-success page hit", {
      reference,
      queryKeys: Object.keys(q),
      userAgent: req.get("user-agent"),
      referer: req.get("referer"),
    })

    if (reference && isAgentPaymentReference(reference)) {
      void reconcileAgentPaymentOnRedirect(reference, deps).catch((err) => {
        console.error("[moolre-redirect] agent reconcile failed", reference, err)
      })
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Payment complete</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 2rem; text-align: center; background: #eef0f3; color: #1a1a1a; }
    p { font-size: 0.95rem; }
  </style>
</head>
<body>
  <p>Payment received. You can close this window.</p>
  <script>
    (function () {
      var ref = ${JSON.stringify(reference || "")};
      var payload = { type: "moolre-payment-success", reference: ref, externalref: ref };
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(payload, "*");
        }
        if (window.opener) {
          window.opener.postMessage(payload, "*");
        }
      } catch (e) {
        console.error("[moolre-redirect] postMessage failed", e);
      }
    })();
  </script>
</body>
</html>`

    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    res.status(200).send(html)
  }
}

/**
 * Complete agent sale server-side when Moolre redirects here (backup if frontend POST is slow).
 * @param {string} paymentReference
 * @param {{
 *   agentPaymentPending: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 * }} deps
 */
async function reconcileAgentPaymentOnRedirect(paymentReference, deps) {
  const existing = await deps.sales.findOne({ paymentReference })
  if (existing) {
    console.log("[moolre-redirect] sale already exists", { paymentReference, saleId: existing._id })
    await markAgentPaymentPendingCompleted(deps.agentPaymentPending, paymentReference, {
      saleId: String(existing._id),
      smsSent: existing.smsSent === true,
    })
    return
  }

  const status = await checkMoolrePaymentStatus(paymentReference)
  console.log("[moolre-redirect] payment status", {
    paymentReference,
    ok: status.ok,
    isPaid: status.isPaid,
    txStatusNum: status.txStatusNum,
    code: status.code,
  })

  if (!status.ok || !status.isPaid) return

  const outcome = await processAgentMomoPaymentSuccess({
    pending: deps.agentPaymentPending,
    packages: deps.packages,
    vouchers: deps.vouchers,
    sales: deps.sales,
    auditLogs: deps.auditLogs,
    paymentReference,
    source: "redirect",
  })
  console.log("[moolre-redirect] agent reconcile outcome", { paymentReference, outcome })
}

/**
 * @param {import("express").Request["query"]} q
 */
function pickReference(q) {
  const keys = ["externalref", "externalRef", "reference", "ref", "paymentReference"]
  for (const key of keys) {
    const v = q[key]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}
