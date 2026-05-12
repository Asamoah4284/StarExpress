import * as React from "react"
import { credentialsMatch, MOCK_LOGIN_EMAIL } from "@/lib/authCredentials.js"

const STORAGE_KEY = "starexpress-auth-session"

/** @typedef {{ name: string, email: string, role: string }} AuthUser */

/** @type {React.Context<{ user: AuthUser | null, isAuthenticated: boolean, login: (email: string, password: string) => boolean, logout: () => void } | null>} */
const AuthContext = React.createContext(null)

function readStoredUser() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.name === "string" && typeof parsed.email === "string" && typeof parsed.role === "string") {
      return /** @type {AuthUser} */ (parsed)
    }
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
  }
  return null
}

function persistUser(user) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user))
}

export function AuthProvider({ children }) {
  const [user, setUser] = React.useState(() => readStoredUser())

  const login = React.useCallback((email, password) => {
    if (!credentialsMatch(email, password)) return false
    const next = {
      name: "System Admin",
      email: MOCK_LOGIN_EMAIL,
      role: "Admin",
    }
    persistUser(next)
    setUser(next)
    return true
  }, [])

  const logout = React.useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }, [])

  const value = React.useMemo(
    () => ({
      user,
      isAuthenticated: user != null,
      login,
      logout,
    }),
    [user, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
