/** Mock console credentials (no backend). */
export const MOCK_LOGIN_EMAIL = "admin@system.com"
/** Typo variant from spec: admin"system.com */
export const MOCK_LOGIN_EMAIL_ALT = 'admin"system.com'
export const MOCK_LOGIN_PASSWORD = "admin1234"

/** @param {string} email */
/** @param {string} password */
export function credentialsMatch(email, password) {
  const e = email.trim()
  const okEmail =
    e.toLowerCase() === MOCK_LOGIN_EMAIL.toLowerCase() || e === MOCK_LOGIN_EMAIL_ALT
  return okEmail && password === MOCK_LOGIN_PASSWORD
}
