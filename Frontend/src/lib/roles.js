export const ROLE_ADMIN = "Admin"
export const ROLE_SALES_AGENT = "Sales Agent"

/** Sidebar `to` values a sales agent may open (read / day-to-day work; no user admin). */
export const SALES_AGENT_NAV_PATHS = [
  "/",
  "/sales",
  "/sales-history",
  "/reports",
  "/packages",
]

/** @param {string | undefined} role */
export function isAdminRole(role) {
  return role === ROLE_ADMIN
}

/**
 * @param {string | undefined} role
 * @param {string} to NavLink `to` (e.g. `/sales`, `/`)
 */
export function roleMayAccessNavPath(role, to) {
  if (isAdminRole(role)) return true
  if (role === ROLE_SALES_AGENT) return SALES_AGENT_NAV_PATHS.includes(to)
  return false
}

/** Default landing path after sign-in. */
export function defaultHomePathForRole(role) {
  return role === ROLE_SALES_AGENT ? "/sales" : "/"
}

/**
 * Where to send the user after login (respects deep-link `from` when allowed).
 * @param {string | undefined} role
 * @param {string} [fromPath] location.state.from or current path
 */
export function postLoginPath(role, fromPath) {
  if (isAdminRole(role)) {
    if (!fromPath || fromPath === "/login" || !fromPath.startsWith("/")) return "/"
    return fromPath
  }
  if (role === ROLE_SALES_AGENT) {
    if (!fromPath || fromPath === "/login" || fromPath === "/signup" || !fromPath.startsWith("/")) {
      return "/sales"
    }
    if (fromPath === "/") return "/sales"
    if (roleMayAccessNavPath(role, fromPath)) return fromPath
    return "/sales"
  }
  return "/"
}
