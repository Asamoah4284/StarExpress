import * as React from "react"
import { authLogin, authMe, authSignup } from "@/lib/api.js"

const STORAGE_KEY = "starexpress-auth-session"

/** @typedef {import("@/types.js").AuthUser} AuthUser */

/** @typedef {"ok" | "exists" | "phone_exists" | "invalid" | "otp_invalid" | "network"} SignupResult */

/** @typedef {{ user: AuthUser, token: string | null }} StoredSession */

/** @typedef {{ ok: true, user: AuthUser } | { ok: false }} LoginResult */

/** @type {React.Context<{ user: AuthUser | null, token: string | null, isAuthenticated: boolean, authReady: boolean, login: (email: string, password: string) => Promise<LoginResult>, signup: (name: string, email: string, phone: string, password: string, otp: string) => Promise<SignupResult>, logout: () => void } | null>} */
const AuthContext = React.createContext(null)

/** @param {unknown} u */
function isAuthUserShape(u) {
  return (
    typeof u === "object" &&
    u !== null &&
    typeof /** @type {{ name?: unknown }} */ (u).name === "string" &&
    typeof /** @type {{ email?: unknown }} */ (u).email === "string" &&
    typeof /** @type {{ role?: unknown }} */ (u).role === "string"
  )
}

/** @returns {StoredSession | null} */
function readStoredSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null

    if ("user" in parsed && isAuthUserShape(parsed.user)) {
      const token = typeof parsed.token === "string" ? parsed.token : null
      if (!token) {
        sessionStorage.removeItem(STORAGE_KEY)
        return null
      }
      return { user: /** @type {AuthUser} */ (parsed.user), token }
    }

    if (isAuthUserShape(parsed)) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
  }
  return null
}

/** @param {StoredSession} session */
function persistSession(session) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function AuthProvider({ children }) {
  const [user, setUser] = React.useState(() => readStoredSession()?.user ?? null)
  const [token, setToken] = React.useState(() => readStoredSession()?.token ?? null)
  const [authReady, setAuthReady] = React.useState(() => {
    const s = readStoredSession()
    return !s?.token
  })

  React.useEffect(() => {
    const session = readStoredSession()
    if (!session?.token) return
    let cancelled = false
    ;(async () => {
      const me = await authMe(session.token)
      if (cancelled) return
      if (me.ok && me.user) {
        setUser(me.user)
        setToken(session.token)
        persistSession({ user: me.user, token: session.token })
      } else {
        sessionStorage.removeItem(STORAGE_KEY)
        setUser(null)
        setToken(null)
      }
      setAuthReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const login = React.useCallback(async (email, password) => {
    try {
      const result = await authLogin(email, password)
      if (!result.ok) return { ok: false }
      persistSession({ user: result.user, token: result.token })
      setUser(result.user)
      setToken(result.token)
      return { ok: true, user: result.user }
    } catch {
      return { ok: false }
    }
  }, [])

  const signup = React.useCallback(async (name, email, phone, password, otp) => {
    try {
      const result = await authSignup(name, email, phone, password, otp)
      if (result.ok) {
        persistSession({ user: result.user, token: result.token })
        setUser(result.user)
        setToken(result.token)
        return "ok"
      }
      if ("code" in result && result.code === "exists") return "exists"
      if ("code" in result && result.code === "phone_exists") return "phone_exists"
      if ("code" in result && result.code === "otp_invalid") return "otp_invalid"
      return "invalid"
    } catch {
      return "network"
    }
  }, [])

  const logout = React.useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    setUser(null)
    setToken(null)
  }, [])

  const value = React.useMemo(
    () => ({
      user,
      token,
      isAuthenticated: user != null,
      authReady,
      login,
      signup,
      logout,
    }),
    [user, token, authReady, login, signup, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
