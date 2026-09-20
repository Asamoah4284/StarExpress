/**
 * RADIUS side of Grandstream's External Captive Portal API.
 *
 * After payment, createShareableRadiusLogin() writes username/password into
 * FreeRADIUS (radcheck/radreply). Grandstream checks those credentials when
 * someone types them on the WiFi login page — Mongo voucher CSVs are not used.
 *
 * generateRadiusSession() still builds an authorizeUrl for optional auto-login;
 * captive /buy no longer redirects there so codes can be shared.
 *
 * Reference: https://documentation.grandstream.com/knowledge-base/external-captive-portal-api-guide/
 */

import crypto from "node:crypto"
import mysql from "mysql2/promise"
import { resolveFrontendBaseUrl } from "./frontendUrl.js"

/**
 * Optional explicit limits keyed by packageId.
 * Prefer package document fields `radiusSessionTimeout` / `radiusMaxOctets` when set.
 * sessionTimeout: seconds (null = unlimited)
 * maxOctets: total bytes up+down (null = unlimited)
 */
export const PACKAGES = {
  "1hr": { sessionTimeout: 3600, maxOctets: null },
  "24hr": { sessionTimeout: 86400, maxOctets: null },
  "1week": { sessionTimeout: 604800, maxOctets: null },
  "5gb": { sessionTimeout: null, maxOctets: 5 * 1024 ** 3 },
  "15gb": { sessionTimeout: null, maxOctets: 15 * 1024 ** 3 },
}

/** @type {import("mysql2/promise").Pool | null} */
let radiusPool = null

function isRadiusConfigured() {
  return Boolean(
    process.env.RADIUS_DB_HOST &&
      process.env.RADIUS_DB_USER &&
      process.env.RADIUS_DB_PASSWORD &&
      process.env.RADIUS_DB_NAME,
  )
}

function getRadiusPool() {
  if (!isRadiusConfigured()) {
    throw new Error(
      "RADIUS database is not configured. Set RADIUS_DB_HOST, RADIUS_DB_USER, RADIUS_DB_PASSWORD, RADIUS_DB_NAME.",
    )
  }
  if (!radiusPool) {
    radiusPool = mysql.createPool({
      host: process.env.RADIUS_DB_HOST,
      user: process.env.RADIUS_DB_USER,
      password: process.env.RADIUS_DB_PASSWORD,
      database: process.env.RADIUS_DB_NAME,
      port: Number(process.env.RADIUS_DB_PORT) || 3306,
      waitForConnections: true,
      connectionLimit: 5,
    })
  }
  return radiusPool
}

/**
 * @param {string} clientMac
 */
function generateCredentials(clientMac) {
  const safeMac = String(clientMac || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toLowerCase()
  const username = `gs-${safeMac || "unknown"}-${Date.now().toString(36)}`
  const password = crypto.randomBytes(12).toString("hex")
  return { username, password }
}

/** Avoid 0/O, 1/I/L so codes are easier to type on a phone. */
const SHAREABLE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

/**
 * @param {number} [length]
 */
export function generateShareableWifiCode(length = 8) {
  const n = Number.isFinite(length) && length > 0 ? Math.min(32, Math.floor(length)) : 8
  const bytes = crypto.randomBytes(n)
  let code = ""
  for (let i = 0; i < n; i++) {
    code += SHAREABLE_CODE_ALPHABET[bytes[i] % SHAREABLE_CODE_ALPHABET.length]
  }
  return code
}

/**
 * Write FreeRADIUS credentials a person can type on the Grandstream login page.
 * Username and password are the same code so SMS and the success screen stay simple.
 *
 * @param {string} packageId
 * @param {{ name?: string, dataLimit?: string, radiusSessionTimeout?: unknown, radiusMaxOctets?: unknown } | null} [pkg]
 * @returns {Promise<{ username: string, password: string, sessionTimeout: number | null, maxOctets: number | null }>}
 */
export async function createShareableRadiusLogin(packageId, pkg = null) {
  const limits = resolveRadiusPackageLimits(packageId, pkg)
  const sessionTimeout = limits.sessionTimeout || (limits.maxOctets ? null : 86400)
  const maxOctets = limits.maxOctets
  const code = generateShareableWifiCode(8)
  await writeRadiusSession({
    username: code,
    password: code,
    sessionTimeout,
    maxOctets,
  })
  console.log("[portal] shareable radius login created", code)
  return { username: code, password: code, sessionTimeout, maxOctets }
}

/**
 * Infer Session-Timeout / data cap from free-text package name or dataLimit.
 * @param {string} [name]
 * @param {string} [dataLimit]
 * @returns {{ sessionTimeout: number | null, maxOctets: number | null }}
 */
function inferLimitsFromPackageText(name = "", dataLimit = "") {
  const text = `${name} ${dataLimit}`.toLowerCase()
  /** @type {number | null} */
  let sessionTimeout = null
  /** @type {number | null} */
  let maxOctets = null

  const week = text.match(/(\d+)\s*(week|weeks|wk)\b/)
  const day = text.match(/(\d+)\s*(day|days)\b/)
  const hour = text.match(/(\d+)\s*(hr|hrs|hour|hours)\b/)
  const minute = text.match(/(\d+)\s*(min|mins|minute|minutes)\b/)
  if (week) sessionTimeout = Number(week[1]) * 604800
  else if (day) sessionTimeout = Number(day[1]) * 86400
  else if (hour) sessionTimeout = Number(hour[1]) * 3600
  else if (minute) sessionTimeout = Number(minute[1]) * 60

  const tb = text.match(/(\d+(?:\.\d+)?)\s*tb\b/)
  const gb = text.match(/(\d+(?:\.\d+)?)\s*gb\b/)
  const mb = text.match(/(\d+(?:\.\d+)?)\s*mb\b/)
  if (tb) maxOctets = Math.round(Number(tb[1]) * 1024 ** 4)
  else if (gb) maxOctets = Math.round(Number(gb[1]) * 1024 ** 3)
  else if (mb) maxOctets = Math.round(Number(mb[1]) * 1024 ** 2)

  return { sessionTimeout, maxOctets }
}

/**
 * Resolve RADIUS limits for a catalog package.
 * @param {string} packageId
 * @param {{ name?: string, dataLimit?: string, radiusSessionTimeout?: unknown, radiusMaxOctets?: unknown } | null} [pkg]
 * @returns {{ sessionTimeout: number | null, maxOctets: number | null }}
 */
export function resolveRadiusPackageLimits(packageId, pkg = null) {
  if (PACKAGES[packageId]) return PACKAGES[packageId]

  const hasExplicitTimeout = pkg && pkg.radiusSessionTimeout != null && pkg.radiusSessionTimeout !== ""
  const hasExplicitOctets = pkg && pkg.radiusMaxOctets != null && pkg.radiusMaxOctets !== ""
  if (hasExplicitTimeout || hasExplicitOctets) {
    const sessionTimeout = hasExplicitTimeout ? Number(pkg.radiusSessionTimeout) : null
    const maxOctets = hasExplicitOctets ? Number(pkg.radiusMaxOctets) : null
    return {
      sessionTimeout: Number.isFinite(sessionTimeout) && sessionTimeout > 0 ? sessionTimeout : null,
      maxOctets: Number.isFinite(maxOctets) && maxOctets > 0 ? maxOctets : null,
    }
  }

  return inferLimitsFromPackageText(
    typeof pkg?.name === "string" ? pkg.name : "",
    typeof pkg?.dataLimit === "string" ? pkg.dataLimit : "",
  )
}

/**
 * @param {{
 *   username: string
 *   password: string
 *   sessionTimeout?: number | null
 *   maxOctets?: number | null
 * }} opts
 */
async function writeRadiusSession({ username, password, sessionTimeout = null, maxOctets = null }) {
  const pool = getRadiusPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    await conn.query(
      "INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)",
      [username, password],
    )

    if (sessionTimeout) {
      await conn.query(
        "INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Session-Timeout', ':=', ?)",
        [username, String(sessionTimeout)],
      )
    }
    if (maxOctets) {
      // Adjust attribute name to whatever your Grandstream RADIUS dictionary supports.
      await conn.query(
        "INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Mikrotik-Total-Limit', ':=', ?)",
        [username, String(maxOctets)],
      )
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/**
 * portalParams = { login_url, ap_mac, client_mac, orig_url, ssid } from the Grandstream redirect on /buy.
 * @param {{ login_url?: string, ap_mac?: string, client_mac?: string, orig_url?: string, ssid?: string }} portalParams
 * @param {string} packageId
 * @param {{ name?: string, dataLimit?: string, radiusSessionTimeout?: unknown, radiusMaxOctets?: unknown } | null} [pkg]
 * @returns {Promise<{ username: string, password: string, authorizeUrl: string, sessionTimeout: number | null, maxOctets: number | null }>}
 */
export async function generateRadiusSession(portalParams, packageId, pkg = null) {
  const login_url = typeof portalParams?.login_url === "string" ? portalParams.login_url.trim() : ""
  const client_mac = typeof portalParams?.client_mac === "string" ? portalParams.client_mac.trim() : ""
  const orig_url = typeof portalParams?.orig_url === "string" ? portalParams.orig_url.trim() : ""

  if (!login_url || !client_mac) {
    throw new Error("Missing login_url or client_mac from captive portal redirect")
  }

  const limits = resolveRadiusPackageLimits(packageId, pkg)
  // Ensure Session-Timeout is always written for hotspot sessions when no package limit is known.
  const sessionTimeout = limits.sessionTimeout || (limits.maxOctets ? null : 86400)
  const maxOctets = limits.maxOctets
  const { username, password } = generateCredentials(client_mac)
  await writeRadiusSession({
    username,
    password,
    sessionTimeout,
    maxOctets,
  })
  console.log("[portal] radius session created", username)

  const redirectTarget = orig_url || `${resolveFrontendBaseUrl()}/portal-payment-success`
  const authorizeUrl =
    `${login_url}?username=${encodeURIComponent(username)}` +
    `&password=${encodeURIComponent(password)}` +
    `&redirect=${encodeURIComponent(redirectTarget)}`
  console.log("[portal] authorizeUrl", authorizeUrl)

  return {
    username,
    password,
    authorizeUrl,
    sessionTimeout,
    maxOctets,
  }
}

export { isRadiusConfigured }
