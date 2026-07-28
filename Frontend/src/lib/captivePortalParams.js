/**
 * Persist Grandstream captive-portal params across the /buy → payment → success flow.
 * Query strings can be lost if the user refreshes mid-flow; sessionStorage keeps them.
 */
const STORAGE_KEY = "starexpress.captivePortalParams"

/**
 * @param {URLSearchParams | { get: (key: string) => string | null }} searchParams
 */
export function readPortalParamsFromSearch(searchParams) {
  /** @param {...string} keys */
  const first = (...keys) => {
    for (const key of keys) {
      const value = searchParams.get(key)
      if (value && value.trim()) return value.trim()
    }
    return ""
  }
  return {
    login_url: first("login_url", "loginUrl", "loginurl", "authaction", "auth_action"),
    ap_mac: first("ap_mac", "apMac", "apmac"),
    client_mac: first("client_mac", "clientMac", "clientmac", "mac", "user_mac", "usermac"),
    orig_url: first("orig_url", "origUrl", "origurl", "redir", "redirect", "continue"),
    ssid: first("ssid", "SSID"),
  }
}

/**
 * @param {{ login_url?: string, ap_mac?: string, client_mac?: string, orig_url?: string, ssid?: string }} params
 */
export function persistPortalParams(params) {
  try {
    if (!params?.login_url && !params?.client_mac) return
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(params))
  } catch {
    /* private mode / unavailable */
  }
}

/** @returns {{ login_url: string, ap_mac: string, client_mac: string, orig_url: string, ssid: string }} */
export function loadPersistedPortalParams() {
  const empty = { login_url: "", ap_mac: "", client_mac: "", orig_url: "", ssid: "" }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return empty
    return {
      login_url: typeof parsed.login_url === "string" ? parsed.login_url : "",
      ap_mac: typeof parsed.ap_mac === "string" ? parsed.ap_mac : "",
      client_mac: typeof parsed.client_mac === "string" ? parsed.client_mac : "",
      orig_url: typeof parsed.orig_url === "string" ? parsed.orig_url : "",
      ssid: typeof parsed.ssid === "string" ? parsed.ssid : "",
    }
  } catch {
    return empty
  }
}

/**
 * Prefer URL params; fall back to sessionStorage.
 * @param {URLSearchParams | { get: (key: string) => string | null }} searchParams
 */
export function resolvePortalParams(searchParams) {
  const fromUrl = readPortalParamsFromSearch(searchParams)
  const fromStore = loadPersistedPortalParams()
  const merged = {
    login_url: fromUrl.login_url || fromStore.login_url,
    ap_mac: fromUrl.ap_mac || fromStore.ap_mac,
    client_mac: fromUrl.client_mac || fromStore.client_mac,
    orig_url: fromUrl.orig_url || fromStore.orig_url,
    ssid: fromUrl.ssid || fromStore.ssid,
  }
  if (merged.login_url || merged.client_mac) {
    persistPortalParams(merged)
  }
  return merged
}

/**
 * @param {{ login_url?: string, client_mac?: string } | null | undefined} params
 */
export function hasPortalAuthParams(params) {
  return Boolean(params?.login_url?.trim() && params?.client_mac?.trim())
}

export function clearPersistedPortalParams() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
