import * as React from "react"
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom"
import { Lock, Loader2, Satellite } from "lucide-react"
import { useAuth } from "@/context/AuthContext.jsx"
import { getDefaultAppName } from "@/lib/env.js"
import { postLoginPath } from "@/lib/roles.js"
import { PasswordField } from "@/components/auth/PasswordField.jsx"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function Login() {
  const appName = getDefaultAppName()
  const { isAuthenticated, authReady, login, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = typeof location.state?.from === "string" ? location.state.from : "/"

  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  if (!authReady) {
    return (
      <div className="text-foreground bg-canvas flex min-h-svh items-center justify-center dark:bg-background">
        <Loader2 className="text-primary size-8 animate-spin" aria-label="Loading" />
      </div>
    )
  }

  if (isAuthenticated && user) {
    const next = postLoginPath(user.role, from === "/login" ? undefined : from)
    return <Navigate to={next} replace />
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(false)
    setSubmitting(true)
    try {
      const result = await login(email, password)
      if (result.ok && result.user) {
        navigate(postLoginPath(result.user.role, from), { replace: true })
      } else {
        setError(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="text-foreground relative flex h-svh max-h-svh flex-col items-center justify-center overflow-hidden bg-canvas px-4 py-3 dark:bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="bg-primary/12 absolute -left-[20%] top-[-10%] h-[min(85vh,640px)] w-[min(85vw,640px)] rounded-full blur-[100px] dark:bg-primary/20" />
        <div className="bg-primary/8 absolute -right-[15%] bottom-[-20%] h-[min(70vh,520px)] w-[min(75vw,520px)] rounded-full blur-[90px] dark:bg-primary/12" />
        <div className="from-background/80 absolute inset-0 bg-gradient-to-b via-transparent to-canvas/90 dark:from-background dark:to-background" />
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.12]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2328a745' fill-opacity='0.10'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      <div className="relative z-10 flex w-full max-w-[400px] flex-col items-center">
        <div className="mb-2.5 text-center sm:mb-3">
          <p className="text-primary font-heading text-[10px] font-semibold uppercase tracking-[0.2em] dark:text-primary sm:text-xs sm:tracking-[0.22em]">
            {appName}
          </p>
          <h1 className="text-foreground mt-1 text-xl font-bold tracking-tight dark:text-foreground sm:text-2xl">
            Team sign-in
          </h1>
          <p className="text-muted-foreground mx-auto mt-1 max-w-[320px] text-[11px] leading-snug dark:text-muted-foreground sm:text-xs">
            Admins and sales agents use the same portal  your menu matches your role after you sign in.
          </p>
        </div>

        <Card className="border-border/70 w-full gap-0 overflow-hidden rounded-xl border bg-card/90 py-0 shadow-[0_16px_48px_-24px_rgba(40,167,69,0.28),0_8px_24px_-14px_rgba(15,23,42,0.1)] ring-1 ring-black/[0.04] backdrop-blur-md dark:bg-card/85 dark:ring-white/[0.08]">
          <div className="from-primary via-primary/90 to-primary/70 h-0.5 w-full bg-gradient-to-r" aria-hidden />

          <CardHeader className="space-y-2 px-4 pb-0 pt-3 text-center sm:px-6 sm:pt-4">
            <div className="relative mx-auto">
              <div className="border-primary/15 bg-card relative flex size-10 items-center justify-center rounded-lg border shadow-sm ring-2 ring-primary/20 dark:border-border dark:bg-muted/30 dark:ring-primary/25">
                <Satellite className="text-primary size-5 stroke-[1.5]" aria-hidden />
              </div>
            </div>
            <div className="space-y-0.5">
              <CardTitle className="font-heading text-base font-semibold tracking-tight sm:text-lg">Sign in</CardTitle>
              <CardDescription className="text-muted-foreground text-[11px] leading-snug dark:text-muted-foreground sm:text-xs">
                Use the email and password issued by your administrator.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="px-4 pb-3 pt-3 sm:px-6 sm:pb-4">
            <form onSubmit={handleSubmit} className="space-y-2.5">
              <div className="space-y-1">
                <Label htmlFor="login-email" className="text-foreground text-xs font-medium dark:text-foreground sm:text-sm">
                  Email
                </Label>
                <Input
                  id="login-email"
                  name="email"
                  type="text"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="border-border/80 bg-background/80 h-9 rounded-md text-sm shadow-none transition-shadow focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-border dark:bg-background/50 dark:focus-visible:ring-primary/30"
                  aria-invalid={error}
                  aria-describedby={error ? "login-error" : undefined}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="login-password" className="text-foreground text-xs font-medium dark:text-foreground sm:text-sm">
                  Password
                </Label>
                <PasswordField
                  id="login-password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="border-border/80 bg-background/80 h-9 rounded-md text-sm shadow-none transition-shadow focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-border dark:bg-background/50 dark:focus-visible:ring-primary/30"
                  aria-invalid={error}
                  aria-describedby={error ? "login-error" : undefined}
                />
              </div>
              {error ? (
                <p id="login-error" className="text-destructive bg-destructive/8 rounded-md px-2.5 py-1.5 text-xs leading-snug dark:bg-destructive/15" role="alert">
                  Invalid email or password. Ensure the API is running and credentials match your Backend/.env.
                </p>
              ) : null}
              <Button
                type="submit"
                size="lg"
                disabled={submitting}
                className="h-9 w-full rounded-md text-sm font-semibold shadow-md shadow-primary/20 transition-[box-shadow,transform] hover:shadow-lg hover:shadow-primary/25 active:scale-[0.99] disabled:opacity-70 dark:shadow-primary/10 dark:hover:shadow-primary/20"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="border-border/60 bg-muted/40 flex items-center justify-center gap-1.5 rounded-b-xl border-t px-4 py-2 dark:border-border/60 dark:bg-muted/25">
            <Lock className="text-muted-foreground size-3 shrink-0 opacity-70" aria-hidden />
            <span className="text-muted-foreground text-[11px] font-medium">API sign-in</span>
          </CardFooter>
        </Card>

        <p className="text-muted-foreground mt-2.5 text-center text-xs dark:text-muted-foreground">
          Need an account?{" "}
          <Link to="/signup" className="text-primary font-medium underline-offset-4 hover:underline dark:text-primary">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
