import * as React from "react"
import { credentialsMatch, MOCK_LOGIN_EMAIL, MOCK_LOGIN_EMAIL_ALT } from "@/lib/authCredentials.js"
import { authLogin, authMe, authSignup } from "@/lib/api.js"
import { isBackendEnabled } from "@/lib/env.js"

const STORAGE_KEY = "starexpress-auth-session"

/** @typedef {import("@/types.js").AuthUser} AuthUser */

/** @typedef {"ok" | "exists" | "invalid" | "network"} SignupResult */

/** @typedef {{ user: AuthUser, token: string | null }} StoredSession */

/** @type {React.Context<{ user: AuthUser | null, token: string | null, isAuthenticated: boolean, authReady: boolean, login: (email: string, password: string) => Promise<boolean>, signup: (name: string, email: string, password: string) => Promise<SignupResult>, logout: () => void } | null>} */
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
      return { user: /** @type {AuthUser} */ (parsed.user), token }
    }

    if (isAuthUserShape(parsed)) {
      return { user: /** @type {AuthUser} */ (parsed), token: null }
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
  const api = isBackendEnabled()
  const [user, setUser] = React.useState(() => readStoredSession()?.user ?? null)
  const [token, setToken] = React.useState(() => readStoredSession()?.token ?? null)
  const [authReady, setAuthReady] = React.useState(() => {
    if (!api) return true
    const s = readStoredSession()
    return !s?.token
  })

  React.useEffect(() => {
    if (!api) return
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
  }, [api])

  const login = React.useCallback(
    async (email, password) => {
      if (!api) {
        if (import.meta.env.DEV) {
          console.info(
            "[StarExpress auth] Mock login — no HTTP request. Add VITE_USE_BACKEND=true (or VITE_USE_API=true) to Frontend/.env and restart Vite to call the API.",
          )
        }
        if (!credentialsMatch(email, password)) return false
        const next = {
          name: "System Admin",
          email: MOCK_LOGIN_EMAIL,
          role: "Admin",
        }
        persistSession({ user: next, token: null })
        setUser(next)
        setToken(null)
        return true
      }
      try {
        const result = await authLogin(email, password)
        if (!result.ok) return false
        persistSession({ user: result.user, token: result.token })
        setUser(result.user)
        setToken(result.token)
        return true
      } catch {
        return false
      }
    },
    [api],
  )

  const signup = React.useCallback(
    async (name, email, password) => {
      if (!api) {
        if (import.meta.env.DEV) {
          console.info(
            "[StarExpress auth] Mock signup — no POST /api/auth/signup. Add VITE_USE_BACKEND=true (or VITE_USE_API=true) to Frontend/.env and restart Vite.",
          )
        }
        const trimmedName = name.trim()
        const trimmedEmail = email.trim()
        if (!trimmedName || trimmedName.length < 2) return "invalid"
        if (!trimmedEmail || !trimmedEmail.includes("@")) return "invalid"
        if (!password || password.length < 6) return "invalid"
        const emailLower = trimmedEmail.toLowerCase()
        if (emailLower === MOCK_LOGIN_EMAIL.toLowerCase() || trimmedEmail === MOCK_LOGIN_EMAIL_ALT) {
          return "exists"
        }
        const next = {
          name: trimmedName,
          email: trimmedEmail,
          role: "Admin",
        }
        persistSession({ user: next, token: null })
        setUser(next)
        setToken(null)
        return "ok"
      }
      try {
        const result = await authSignup(name, email, password)
        if (result.ok) {
          persistSession({ user: result.user, token: result.token })
          setUser(result.user)
          setToken(result.token)
          return "ok"
        }
        if ("code" in result && result.code === "exists") return "exists"
        return "invalid"
      } catch {
        return "network"
      }
    },
    [api],
  )

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
