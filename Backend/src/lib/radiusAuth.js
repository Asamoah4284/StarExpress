/**
 * FreeRADIUS / daloRADIUS SQL helpers.
 *
 * Vouchers are created in daloRADIUS and uploaded to this app. On purchase we
 * SMS the existing username and set Expiration + Session-Timeout from the
 * package duration. When that window ends we delete the RADIUS user.
 */

import crypto from "node:crypto"
import mysql from "mysql2/promise"
import { resolveFrontendBaseUrl } from "./frontendUrl.js"
import { buyLog, buyError, errorForLog } from "./buyLog.js"

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
      connectTimeout: 2000,
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

const RADIUS_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * FreeRADIUS / daloRADIUS Expiration check-item, e.g. `20 Sep 2026 15:21:00`.
 * @param {Date} date
 */
function formatRadiusExpiration(date) {
  const d = date.getUTCDate()
  const mon = RADIUS_MONTHS[date.getUTCMonth()]
  const y = date.getUTCFullYear()
  const hh = String(date.getUTCHours()).padStart(2, "0")
  const mm = String(date.getUTCMinutes()).padStart(2, "0")
  const ss = String(date.getUTCSeconds()).padStart(2, "0")
  return `${d} ${mon} ${y} ${hh}:${mm}:${ss}`
}

/**
 * @param {Date} date
 */
function formatMysqlDatetime(date) {
  return date.toISOString().slice(0, 19).replace("T", " ")
}

/**
 * @param {number} seconds
 */
export function formatDurationLabel(seconds) {
  const sec = Number(seconds)
  if (!Number.isFinite(sec) || sec <= 0) return ""
  if (sec % 86400 === 0) {
    const d = sec / 86400
    return d === 1 ? "1 day" : `${d} days`
  }
  if (sec % 3600 === 0) {
    const h = sec / 3600
    return h === 1 ? "1 hour" : `${h} hours`
  }
  if (sec % 60 === 0) {
    const m = sec / 60
    return m === 1 ? "1 minute" : `${m} minutes`
  }
  return `${Math.round(sec)} seconds`
}

/**
 * @param {import("mysql2/promise").PoolConnection} conn
 * @param {string} sql
 * @param {unknown[]} params
 */
async function tryRadiusQuery(conn, sql, params) {
  try {
    await conn.query(sql, params)
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : ""
    if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") return
    throw err
  }
}

/**
 * @param {import("mysql2/promise").PoolConnection} conn
 * @param {"radcheck" | "radreply"} table
 * @param {string} username
 * @param {string} attribute
 * @param {string} op
 * @param {string} value
 */
async function upsertRadiusAttribute(conn, table, username, attribute, op, value) {
  await conn.query(`DELETE FROM ${table} WHERE username = ? AND attribute = ?`, [username, attribute])
  await conn.query(`INSERT INTO ${table} (username, attribute, op, value) VALUES (?, ?, ?, ?)`, [
    username,
    attribute,
    op,
    value,
  ])
}

/**
 * Clock starts at purchase: set daloRADIUS/FreeRADIUS Expiration + Session-Timeout
 * on the already-created username (do not create a new login).
 *
 * @param {{
 *   username: string
 *   sessionTimeout: number
 *   maxOctets?: number | null
 *   expiresAt: Date
 * }} opts
 */
export async function activateSoldRadiusVoucher(opts) {
  const username = String(opts.username || "").trim()
  if (!username) throw new Error("RADIUS username is required.")
  const sessionTimeout = Math.round(Number(opts.sessionTimeout))
  const expiresAt = opts.expiresAt instanceof Date ? opts.expiresAt : new Date(opts.expiresAt)
  const pool = getRadiusPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [passwordRows] = await conn.query(
      "SELECT id FROM radcheck WHERE username = ? AND attribute IN ('Cleartext-Password','User-Password','MD5-Password','SHA-Password','NT-Password','Crypt-Password') LIMIT 1",
      [username],
    )
    if (!Array.isArray(passwordRows) || passwordRows.length === 0) {
      buyError("radius sold code missing radcheck password row", { username })
    }

    await tryRadiusQuery(
      conn,
      "DELETE FROM radcheck WHERE username = ? AND attribute = 'Auth-Type' AND UPPER(value) = 'REJECT'",
      [username],
    )

    if (Number.isFinite(sessionTimeout) && sessionTimeout > 0) {
      await upsertRadiusAttribute(conn, "radcheck", username, "Expiration", ":=", formatRadiusExpiration(expiresAt))
      await upsertRadiusAttribute(conn, "radreply", username, "Session-Timeout", ":=", String(sessionTimeout))
    }
    if (opts.maxOctets != null && Number(opts.maxOctets) > 0) {
      await upsertRadiusAttribute(conn, "radreply", username, "Mikrotik-Total-Limit", ":=", String(Math.round(Number(opts.maxOctets))))
    }

    const mysqlExpires = formatMysqlDatetime(expiresAt)
    await tryRadiusQuery(conn, "UPDATE userinfo SET updatedate = NOW() WHERE username = ?", [username])
    await tryRadiusQuery(conn, "UPDATE userbillinfo SET expirationdate = ? WHERE username = ?", [mysqlExpires, username])

    await conn.commit()
    buyLog("radius purchase window set", {
      username,
      sessionTimeout,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (err) {
    await conn.rollback()
    buyError("radius purchase window write failed", { username, ...errorForLog(err) })
    throw err
  } finally {
    conn.release()
  }
}

/**
 * Disable the hotspot login after the paid window (same username daloRADIUS created).
 * @param {string} username
 */
export async function removeRadiusUser(username) {
  const name = String(username || "").trim()
  if (!name) return
  const pool = getRadiusPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await tryRadiusQuery(conn, "DELETE FROM radcheck WHERE username = ?", [name])
    await tryRadiusQuery(conn, "DELETE FROM radreply WHERE username = ?", [name])
    await tryRadiusQuery(conn, "DELETE FROM radusergroup WHERE username = ?", [name])
    await tryRadiusQuery(conn, "DELETE FROM userinfo WHERE username = ?", [name])
    await tryRadiusQuery(conn, "DELETE FROM userbillinfo WHERE username = ?", [name])
    await conn.commit()
    console.log("[radius] removed expired user", { username: name })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/**
 * Bind a sold uploaded voucher to the package duration. SMS still goes out if RADIUS is down.
 *
 * @param {{
 *   username: string
 *   packageId?: string
 *   pkg?: { name?: string, dataLimit?: string, radiusSessionTimeout?: unknown, radiusMaxOctets?: unknown } | null
 *   soldAt?: string
 * }} opts
 * @returns {Promise<{ radiusExpiresAt: string, radiusSessionTimeout: number, radiusBoundAt?: string }>}
 */
export async function applyPurchaseRadiusWindow(opts) {
  const username = String(opts.username || "").trim()
  const limits = resolveRadiusPackageLimits(opts.packageId || "", opts.pkg || null)
  const sessionTimeout =
    limits.sessionTimeout && limits.sessionTimeout > 0 ? Math.round(limits.sessionTimeout) : 86400
  const startMs = Date.parse(String(opts.soldAt || ""))
  const start = Number.isFinite(startMs) ? startMs : Date.now()
  const expiresAt = new Date(start + sessionTimeout * 1000)
  /** @type {{ radiusExpiresAt: string, radiusSessionTimeout: number, radiusBoundAt?: string }} */
  const fields = {
    radiusExpiresAt: expiresAt.toISOString(),
    radiusSessionTimeout: sessionTimeout,
  }
  if (!username) {
    buyError("radius window skipped — empty code")
    return fields
  }
  if (!isRadiusConfigured()) {
    buyError("radius window skipped — RADIUS_DB_* not set", { username, sessionTimeout, expiresAt: fields.radiusExpiresAt })
    return fields
  }
  try {
    buyLog("radius window applying", { username, sessionTimeout, expiresAt: fields.radiusExpiresAt, maxOctets: limits.maxOctets })
    await activateSoldRadiusVoucher({
      username,
      sessionTimeout,
      maxOctets: limits.maxOctets,
      expiresAt,
    })
    fields.radiusBoundAt = new Date().toISOString()
    buyLog("radius window applied", { username, ...fields })
  } catch (err) {
    buyError("radius apply purchase window failed", {
      username,
      ...errorForLog(err),
    })
  }
  return fields
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
