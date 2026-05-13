import * as React from "react"
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom"
import { Lock, Loader2, UserPlus } from "lucide-react"
import { useAuth } from "@/context/AuthContext.jsx"
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

export default function Signup() {
  const { isAuthenticated, authReady, signup } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = typeof location.state?.from === "string" ? location.state.from : "/"

  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [error, setError] = React.useState(null)
  const [submitting, setSubmitting] = React.useState(false)

  if (!authReady) {
    return (
      <div className="text-foreground bg-canvas flex min-h-svh items-center justify-center dark:bg-background">
        <Loader2 className="text-primary size-8 animate-spin" aria-label="Loading" />
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to={from === "/signup" ? "/" : from} replace />
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError("mismatch")
      return
    }
    setSubmitting(true)
    try {
      const result = await signup(name, email, password)
      if (result === "ok") {
        navigate(from === "/signup" || !from.startsWith("/") ? "/" : from, { replace: true })
      } else if (result === "exists") {
        setError("exists")
      } else if (result === "network") {
        setError("network")
      } else {
        setError("invalid")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const errorMessage =
    error === "mismatch"
      ? "Passwords do not match. Re-enter them and try again."
      : error === "exists"
        ? "An account with this email already exists. Sign in instead."
        : error === "invalid"
          ? "Enter your full name (2+ characters), a valid email, and a password of at least 6 characters."
          : error === "network"
            ? "Could not reach the server. Start the API and check your network connection."
            : null

  return (
    <div className="text-foreground relative flex min-h-svh flex-col items-center justify-start overflow-hidden bg-canvas px-4 pb-4 pt-4 sm:justify-center sm:p-6 sm:pb-6 sm:pt-6 dark:bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="bg-primary/12 absolute -left-[20%] top-[-10%] h-[min(85vh,640px)] w-[min(85vw,640px)] rounded-full blur-[100px] dark:bg-primary/20" />
        <div className="bg-primary/8 absolute -right-[15%] bottom-[-20%] h-[min(70vh,520px)] w-[min(75vw,520px)] rounded-full blur-[90px] dark:bg-primary/12" />
        <div className="from-background/80 absolute inset-0 bg-gradient-to-b via-transparent to-canvas/90 dark:from-background dark:to-background" />
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.12]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%237c3aed' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-center">
        <div className="mb-3 text-center sm:mb-5">
          <p className="text-primary font-heading text-[10px] font-semibold uppercase tracking-[0.2em] dark:text-primary sm:text-xs sm:tracking-[0.22em]">
            StarExpress
          </p>
          <h1 className="text-foreground mt-1.5 text-2xl font-bold tracking-tight dark:text-foreground sm:mt-2 sm:text-[1.75rem] sm:leading-tight">
            Create your workspace
          </h1>
          <p className="text-muted-foreground mx-auto mt-1 max-w-[340px] text-xs leading-snug dark:text-muted-foreground sm:mt-1.5 sm:text-sm sm:leading-snug">
            First user becomes an administrator; add sales agents later from Users.
          </p>
        </div>

        <Card className="border-border/70 w-full gap-0 overflow-hidden rounded-xl border bg-card/90 py-0 shadow-[0_20px_60px_-24px_rgba(124,58,237,0.3),0_8px_28px_-14px_rgba(15,23,42,0.1)] ring-1 ring-black/[0.04] backdrop-blur-md dark:bg-card/85 dark:shadow-[0_28px_90px_-32px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.06)] dark:ring-white/[0.08] sm:rounded-2xl sm:shadow-[0_28px_90px_-28px_rgba(124,58,237,0.35),0_12px_40px_-18px_rgba(15,23,42,0.12)]">
          <div className="from-primary via-primary/90 to-primary/70 h-0.5 w-full bg-gradient-to-r sm:h-0.5" aria-hidden />

          <CardHeader className="space-y-2 px-4 pb-0 pt-3 text-center sm:space-y-3 sm:px-6 sm:pb-1 sm:pt-5">
            <div className="relative mx-auto">
              <div className="from-primary/25 absolute inset-0 scale-110 rounded-2xl bg-gradient-to-br to-transparent blur-md dark:from-primary/35" aria-hidden />
              <div className="border-primary/15 bg-card relative flex size-11 items-center justify-center rounded-lg border shadow-md ring-2 ring-primary/20 dark:border-border dark:bg-muted/30 dark:ring-primary/25 sm:size-14 sm:rounded-xl">
                <UserPlus className="text-primary size-5 stroke-[1.5] dark:text-primary sm:size-7" aria-hidden />
              </div>
            </div>
            <div className="space-y-0.5 sm:space-y-1">
              <CardTitle className="font-heading text-base font-semibold tracking-tight sm:text-xl">Create account</CardTitle>
              <CardDescription className="text-muted-foreground text-[11px] leading-snug dark:text-muted-foreground sm:text-xs sm:leading-snug">
                Set up your administrator profile. You will be signed in right away in this demo.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="px-4 pb-0 pt-0 sm:px-6 sm:pb-1">
            <form onSubmit={handleSubmit} className="space-y-2.5 sm:space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="signup-name" className="text-foreground text-xs font-medium dark:text-foreground sm:text-sm">
                  Full name
                </Label>
                <Input
                  id="signup-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Admin"
                  className="border-border/80 bg-background/80 h-9 rounded-md text-sm shadow-none transition-shadow focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-border dark:bg-background/50 dark:focus-visible:ring-primary/30 sm:h-10 sm:rounded-lg sm:text-sm"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "signup-error" : undefined}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-email" className="text-foreground text-xs font-medium dark:text-foreground sm:text-sm">
                  Email
                </Label>
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="border-border/80 bg-background/80 h-9 rounded-md text-sm shadow-none transition-shadow focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-border dark:bg-background/50 dark:focus-visible:ring-primary/30 sm:h-10 sm:rounded-lg sm:text-sm"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "signup-error" : undefined}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-password" className="text-foreground text-xs font-medium dark:text-foreground sm:text-sm">
                  Password
                </Label>
                <PasswordField
                  id="signup-password"
                  name="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="border-border/80 bg-background/80 h-9 rounded-md text-sm shadow-none transition-shadow focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-border dark:bg-background/50 dark:focus-visible:ring-primary/30 sm:h-10 sm:rounded-lg sm:text-sm"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "signup-error" : undefined}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-confirm" className="text-foreground text-xs font-medium dark:text-foreground sm:text-sm">
                  Confirm password
                </Label>
                <PasswordField
                  id="signup-confirm"
                  name="confirmPassword"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="border-border/80 bg-background/80 h-9 rounded-md text-sm shadow-none transition-shadow focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-border dark:bg-background/50 dark:focus-visible:ring-primary/30 sm:h-10 sm:rounded-lg sm:text-sm"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "signup-error" : undefined}
                />
              </div>
              {errorMessage ? (
                <p id="signup-error" className="text-destructive bg-destructive/8 rounded-md px-2 py-1 text-[11px] leading-snug dark:bg-destructive/15 sm:px-2.5 sm:py-1.5 sm:text-xs sm:leading-normal" role="alert">
                  {errorMessage}
                </p>
              ) : null}
              <Button
                type="submit"
                size="lg"
                disabled={submitting}
                className="h-9 w-full rounded-md text-sm font-semibold shadow-md shadow-primary/20 transition-[box-shadow,transform] hover:shadow-lg hover:shadow-primary/25 active:scale-[0.99] disabled:opacity-70 dark:shadow-primary/10 dark:hover:shadow-primary/20 sm:h-10 sm:rounded-lg"
              >
                {submitting ? "Creating…" : "Create account"}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="border-border/60 bg-muted/40 flex flex-col gap-0.5 rounded-b-xl border-t px-4 py-2 sm:rounded-b-2xl sm:px-6 sm:py-2.5 dark:border-border/60 dark:bg-muted/25">
            <div className="text-muted-foreground flex items-center justify-center gap-1.5 text-[10px] font-medium dark:text-muted-foreground sm:text-[11px]">
              <Lock className="size-3 shrink-0 opacity-70" aria-hidden />
              <span>API sign-up</span>
            </div>
            <p className="text-muted-foreground text-center text-[10px] leading-snug dark:text-muted-foreground sm:text-[11px] sm:leading-relaxed">
              New accounts are stored in MongoDB. You receive a JWT stored in session storage.
            </p>
          </CardFooter>
        </Card>

        <p className="text-muted-foreground mt-3 text-center text-xs dark:text-muted-foreground sm:mt-4">
          Already have an account?{" "}
          <Link to="/login" className="text-primary font-medium underline-offset-4 hover:underline dark:text-primary">
            Sign in
          </Link>
        </p>

        <p className="text-muted-foreground mt-1.5 max-w-sm text-center text-[10px] leading-snug dark:text-muted-foreground sm:mt-2 sm:text-[11px] sm:leading-relaxed">
          This is a front-end demo. Do not reuse these credentials in production.
        </p>
      </div>
    </div>
  )
}
