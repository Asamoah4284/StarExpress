import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Check, Copy, Loader2, Satellite } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getDefaultAppName } from "@/lib/env.js"
import { clearPersistedPortalParams } from "@/lib/captivePortalParams.js"
import { fetchPortalPaymentStatus, completePortalPayment } from "@/lib/portalApi.js"

/**
 * @param {{ label: string, value: string }} props
 */
function CredentialRow({ label, value }) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</p>
      <button
        type="button"
        onClick={() => void copy()}
        className="border-border bg-muted/40 hover:bg-muted/70 flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left"
        title="Tap to copy"
      >
        <span className="font-mono text-xl font-bold tracking-[0.18em]">{value}</span>
        {copied ? (
          <Check className="size-5 shrink-0 text-emerald-500" aria-hidden />
        ) : (
          <Copy className="text-muted-foreground size-5 shrink-0" aria-hidden />
        )}
      </button>
    </div>
  )
}

export default function PortalPaymentSuccess() {
  const appName = getDefaultAppName()
  const [searchParams] = useSearchParams()
  const paymentReference =
    searchParams.get("externalref") ||
    searchParams.get("externalRef") ||
    searchParams.get("reference") ||
    searchParams.get("ref") ||
    ""

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(/** @type {string | null} */ (null))
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [packageName, setPackageName] = React.useState("WiFi")
  const [smsSent, setSmsSent] = React.useState(false)

  React.useEffect(() => {
    document.title = "Your WiFi login"
  }, [])

  React.useEffect(() => {
    if (!paymentReference) {
      setLoading(false)
      setError("Missing payment reference. Open Buy WiFi again and complete payment.")
      return
    }

    let cancelled = false
    const started = Date.now()
    const maxMs = 45_000
    /** @type {ReturnType<typeof setInterval> | null} */
    let intervalId = null

    const applyReady = (status) => {
      const user = (status.username || status.voucherCode || "").trim()
      const pass = (status.password || user).trim()
      if (!user) return false
      clearPersistedPortalParams()
      setUsername(user)
      setPassword(pass)
      setPackageName(status.packageName || "WiFi")
      setSmsSent(status.smsSent === true)
      setError(null)
      setLoading(false)
      return true
    }

    const tick = async () => {
      const status = await fetchPortalPaymentStatus(paymentReference)
      if (cancelled) return
      if (status.ok && status.ready && applyReady(status)) {
        if (intervalId) clearInterval(intervalId)
        return
      }
      if (Date.now() - started >= maxMs) {
        if (intervalId) clearInterval(intervalId)
        setError(
          "Payment was received but the WiFi login was not created yet. Tap Try again. If it still fails, the server could not reach FreeRADIUS MySQL.",
        )
        setLoading(false)
      }
    }

    setLoading(true)
    setError(null)
    void (async () => {
      const complete = await completePortalPayment(paymentReference)
      if (cancelled) return
      if (complete.ok && applyReady(complete)) return
      void tick()
      intervalId = setInterval(() => void tick(), 1000)
    })()

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [paymentReference])

  return (
    <div className="text-foreground relative flex min-h-svh flex-col items-center justify-center bg-canvas px-4 py-8 dark:bg-background">
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="bg-primary/10 mx-auto mb-3 flex size-12 items-center justify-center rounded-xl">
            <Satellite className="text-primary size-6" aria-hidden />
          </div>
          <p className="text-primary text-xs font-semibold uppercase tracking-widest">{appName}</p>
        </div>

        {loading ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="text-primary size-10 animate-spin" aria-hidden />
              <p className="text-sm font-medium">Sending your WiFi username and password…</p>
              <p className="text-muted-foreground text-xs">This usually takes a few seconds.</p>
            </CardContent>
          </Card>
        ) : null}

        {!loading && error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">WiFi login is on the way</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                className="w-full"
                onClick={() => {
                  setError(null)
                  setLoading(true)
                  setUsername("")
                  setPassword("")
                  window.location.reload()
                }}
              >
                Try again
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link to="/retrieve-voucher">Look up by phone</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !error && username ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your WiFi login</CardTitle>
              <CardDescription>
                {packageName}. Enter these on the WiFi login page. You can share them with someone else.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CredentialRow label="Username" value={username} />
              <CredentialRow label="Password" value={password || username} />
              <p className="text-muted-foreground text-sm">
                {smsSent
                  ? "We also texted username and password to the phone number you paid with."
                  : "Save these. If SMS did not arrive, use Look up by phone with the number you paid with."}
              </p>
              <Button asChild className="w-full">
                <Link to="/retrieve-voucher">Look up by phone</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
