const MAX_LABEL_LENGTH = 120
const MAX_LOGO_DATA_URL_LENGTH = 600_000
const MAX_ALERT_PHONE_LENGTH = 200
export const NEW_ORG_COMMISSION_RATE = 0.167

const LOGO_DATA_URL_RE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i
const ALERT_PHONE_RE = /^[0-9+\-(),\s]+$/

/** @param {string | undefined} orgId */
function settingsDocId(orgId) {
  return typeof orgId === "string" ? orgId.trim() : ""
}

/** @returns {string} */
export function defaultAppName() {
  const raw = process.env.APP_NAME
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, MAX_LABEL_LENGTH) : "EverGreen WISP"
}

/** @returns {string} */
export function defaultCompanyName() {
  const raw = process.env.COMPANY_NAME
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, MAX_LABEL_LENGTH) : "EverGreen WISP"
}

/**
 * @param {unknown} value
 * @param {string} fallback
 */
export function normalizeLabel(value, fallback) {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim().slice(0, MAX_LABEL_LENGTH)
  return trimmed || fallback
}

/**
 * @param {unknown} value
 * @returns {string | null | undefined} `undefined` = omit from patch
 */
export function normalizeCompanyLogoUrl(value) {
  if (value === null || value === "") return null
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!LOGO_DATA_URL_RE.test(trimmed)) {
    throw new Error("Logo must be a PNG, JPEG, GIF, WebP, or SVG image.")
  }
  if (trimmed.length > MAX_LOGO_DATA_URL_LENGTH) {
    throw new Error("Logo file is too large. Use an image under 400 KB.")
  }
  return trimmed
}

/**
 * Default alert phone(s) from env (comma/space separated). Empty when unset.
 * @returns {string}
 */
export function defaultAlertPhone() {
  const raw = process.env.ADMIN_ALERT_PHONE
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, MAX_ALERT_PHONE_LENGTH) : ""
}

/**
 * Normalize the alert phone field.
 * @param {unknown} value
 * @returns {string | undefined} `""` clears it, a string sets it, `undefined` = omit from patch.
 */
export function normalizeAlertPhone(value) {
  if (value === null || value === "") return ""
  if (typeof value !== "string") return undefined
  const trimmed = value.trim().slice(0, MAX_ALERT_PHONE_LENGTH)
  if (!trimmed) return ""
  if (!ALERT_PHONE_RE.test(trimmed)) {
    throw new Error("Alert phone can only contain digits, +, spaces, commas, and hyphens.")
  }
  return trimmed
}

/** @returns {number} */
export function defaultSalesAgentCommissionRate() {
  const raw = process.env.SALES_AGENT_COMMISSION_RATE
  const n = typeof raw === "string" && raw.trim() ? Number.parseFloat(raw.trim()) : NEW_ORG_COMMISSION_RATE
  if (!Number.isFinite(n) || n < 0) return NEW_ORG_COMMISSION_RATE
  return Math.min(1, n)
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function normalizeCommissionRate(value) {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(n) || n < 0 || n > 1) return null
  return Math.round(n * 10000) / 10000
}

/**
 * @param {import("mongodb").Collection} appSettings
 * @param {string} [orgId]
 */
export async function getSalesAgentCommissionRate(appSettings, orgId) {
  const docId = settingsDocId(orgId)
  const doc = docId ? await appSettings.findOne({ _id: docId }) : null
  const stored = doc && typeof doc.salesAgentCommissionRate === "number" ? doc.salesAgentCommissionRate : null
  const normalized = stored != null ? normalizeCommissionRate(stored) : null
  return normalized ?? defaultSalesAgentCommissionRate()
}

/**
 * @param {import("mongodb").Collection} appSettings
 * @param {number} rate 0–1
 * @param {{ userId?: string, orgId?: string } | undefined} auth
 */
export async function setSalesAgentCommissionRate(appSettings, rate, auth) {
  const normalized = normalizeCommissionRate(rate)
  if (normalized == null) {
    throw new Error("Invalid commission rate.")
  }
  const docId = settingsDocId(auth?.orgId)
  if (!docId) throw new Error("Organization is required.")
  await appSettings.updateOne(
    { _id: docId },
    {
      $set: {
        orgId: docId,
        salesAgentCommissionRate: normalized,
        updatedAt: new Date().toISOString(),
        updatedBy: auth?.userId ?? null,
      },
    },
    { upsert: true },
  )
  return normalized
}

/**
 * @param {import("mongodb").Collection} appSettings
 * @param {string} [orgId]
 */
export async function getAppSettings(appSettings, orgId) {
  const docId = settingsDocId(orgId)
  const doc = docId ? await appSettings.findOne({ _id: docId }) : null
  const salesAgentCommissionRate = await getSalesAgentCommissionRate(appSettings, orgId)
  const appName = normalizeLabel(doc?.appName, defaultAppName())
  const companyName = normalizeLabel(doc?.companyName, defaultCompanyName())
  const companyLogoUrl =
    typeof doc?.companyLogoUrl === "string" && LOGO_DATA_URL_RE.test(doc.companyLogoUrl.trim())
      ? doc.companyLogoUrl.trim()
      : null
  const alertPhone =
    typeof doc?.alertPhone === "string" && doc.alertPhone.trim()
      ? doc.alertPhone.trim()
      : defaultAlertPhone()
  const purchaseAlertsEnabled =
    typeof doc?.purchaseAlertsEnabled === "boolean" ? doc.purchaseAlertsEnabled : true
  const promosVisible = typeof doc?.promosVisible === "boolean" ? doc.promosVisible : true
  return {
    salesAgentCommissionRate,
    appName,
    companyName,
    companyLogoUrl,
    alertPhone,
    purchaseAlertsEnabled,
    promosVisible,
  }
}

/**
 * @param {import("mongodb").Collection} appSettings
 * @param {{ salesAgentCommissionRate?: number, appName?: string, companyName?: string, companyLogoUrl?: string | null, alertPhone?: string | null, purchaseAlertsEnabled?: boolean, promosVisible?: boolean }} patch
 * @param {{ userId?: string, orgId?: string } | undefined} auth
 */
export async function patchAppSettings(appSettings, patch, auth) {
  /** @type {Record<string, unknown>} */
  const $set = {
    updatedAt: new Date().toISOString(),
    updatedBy: auth?.userId ?? null,
  }
  const docId = settingsDocId(auth?.orgId)
  if (!docId) throw new Error("Organization is required.")
  $set.orgId = docId
  let savedRate = null

  if (patch.salesAgentCommissionRate != null) {
    const normalized = normalizeCommissionRate(patch.salesAgentCommissionRate)
    if (normalized == null) throw new Error("Invalid commission rate.")
    $set.salesAgentCommissionRate = normalized
    savedRate = normalized
  }

  if (patch.appName != null) {
    $set.appName = normalizeLabel(patch.appName, defaultAppName())
  }

  if (patch.companyName != null) {
    $set.companyName = normalizeLabel(patch.companyName, defaultCompanyName())
  }

  if (patch.companyLogoUrl !== undefined) {
    const logo = normalizeCompanyLogoUrl(patch.companyLogoUrl)
    if (logo === undefined) throw new Error("Invalid company logo.")
    $set.companyLogoUrl = logo
  }

  if (patch.alertPhone !== undefined) {
    const normalized = normalizeAlertPhone(patch.alertPhone)
    if (normalized === undefined) throw new Error("Invalid alert phone.")
    $set.alertPhone = normalized
  }

  if (typeof patch.purchaseAlertsEnabled === "boolean") {
    $set.purchaseAlertsEnabled = patch.purchaseAlertsEnabled
  }

  if (typeof patch.promosVisible === "boolean") {
    $set.promosVisible = patch.promosVisible
  }

  await appSettings.updateOne({ _id: docId }, { $set }, { upsert: true })

  const current = await getAppSettings(appSettings, auth?.orgId)
  if (savedRate != null) current.salesAgentCommissionRate = savedRate
  return current
}

/**
 * Private workspace settings for a new signup. Never copies the global or another org row.
 * @param {import("mongodb").Collection} appSettings
 * @param {{ orgId: string, name: string }} opts
 */
export async function seedOrgAppSettings(appSettings, opts) {
  const orgId = typeof opts.orgId === "string" ? opts.orgId.trim() : ""
  if (!orgId) return
  const label = normalizeLabel(opts.name, defaultAppName())
  const now = new Date().toISOString()
  await appSettings.updateOne(
    { _id: orgId },
    {
      $setOnInsert: {
        orgId,
        salesAgentCommissionRate: NEW_ORG_COMMISSION_RATE,
        appName: label,
        companyName: label,
        companyLogoUrl: null,
        createdAt: now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true },
  )
}
