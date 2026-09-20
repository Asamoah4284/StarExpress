import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Loader2, Satellite } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { HotspotConnectForm } from "@/components/portal/HotspotConnectForm.jsx"
import { getDefaultAppName } from "@/lib/env.js"
import {
  persistPortalParams,
  portalParamsFromApi,
  resolvePortalParams,
} from "@/lib/captivePortalParams.js"
import { fetchPortalPaymentStatus, completePortalPayment } from "@/lib/portalApi.js"

export default function PortalPaymentSuccess() {
  const appName = getDefaultAppName()
  const [searchParams] = useSearchParams()
  const paymentReference =
    searchParams.get("externalref") ||
    searchParams.get("externalRef") ||
    searchParams.get("reference") ||
    searchParams.get("ref") ||
    ""

  const searchKey = searchParams.toString()
  const storedPortal = React.useMemo(
    () => resolvePortalParams(new URLSearchParams(searchKey)),
    [searchKey],
  )
  const storedPortalRef = React.useRef(storedPortal)
  storedPortalRef.current = storedPortal
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(/** @type {string | null} */ (null))
  const [voucherCode, setVoucherCode] = React.useState("")
  const [packageName, setPackageName] = React.useState("WiFi")
  const [smsSent, setSmsSent] = React.useState(false)
  const [portal, setPortal] = React.useState(storedPortal)
  const [authorizeUrl, setAuthorizeUrl] = React.useState("")

  React.useEffect(() => {
    document.title = "Your WiFi code"
  }, [])

  React.useEffect(() => {
    if (!paymentReference) {
      console.error("[buy] success page missing payment reference")
      setLoading(false)
      setError("Missing payment reference. Open Buy WiFi again and complete payment.")
      return
    }

    console.log("[buy] success page start", { paymentReference })

    let cancelled = false
    const started = Date.now()
    const maxMs = 45_000
    /** @type {ReturnType<typeof setInterval> | null} */
    let intervalId = null

    const applyReady = (status) => {
      const code = (status.voucherCode || "").trim()
      const stored = storedPortalRef.current
      console.log("[buy] success applyReady", {
        paymentReference,
        code,
        smsSent: status.smsSent,
        packageName: status.packageName,
        hasLoginUrl: Boolean(status.login_url || stored.login_url),
      })
      if (!code) return false
      const fromApi = portalParamsFromApi(status)
      const merged = {
        login_url: fromApi.login_url || stored.login_url,
        ap_mac: fromApi.ap_mac || stored.ap_mac,
        client_mac: fromApi.client_mac || stored.client_mac,
        orig_url: fromApi.orig_url || stored.orig_url,
        ssid: fromApi.ssid || stored.ssid,
      }
      if (merged.login_url || merged.client_mac) persistPortalParams(merged)
      setPortal(merged)
      setAuthorizeUrl(typeof status.authorizeUrl === "string" ? status.authorizeUrl.trim() : "")
      setVoucherCode(code)
      setPackageName(status.packageName || "WiFi")
      setSmsSent(status.smsSent === true)
      setError(null)
      setLoading(false)
      return true
    }

    const tick = async () => {
      console.log("[buy] success poll status", { paymentReference })
      const status = await fetchPortalPaymentStatus(paymentReference)
      if (cancelled) return
      console.log("[buy] success poll result", status)
      if (status.ok && status.ready && applyReady(status)) {
        if (intervalId) clearInterval(intervalId)
        return
      }
      if (Date.now() - started >= maxMs) {
        if (intervalId) clearInterval(intervalId)
        console.error("[buy] success timed out waiting for code", { paymentReference, status })
        setError(
          "Payment was received but the WiFi code is not ready yet. Tap Try again. If it still fails, contact support with the phone number you paid with.",
        )
        setLoading(false)
      }
    }

    setLoading(true)
    setError(null)
    void (async () => {
      console.log("[buy] success complete payment", { paymentReference })
      const complete = await completePortalPayment(paymentReference)
      console.log("[buy] success complete result", complete)
      if (cancelled) return
      if (complete.ok && applyReady(complete)) return
      void tick()
      intervalId = setInterval(() => void tick(), 4000)
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
              <p className="text-sm font-medium">Sending your WiFi code…</p>
              <p className="text-muted-foreground text-xs">This usually takes a few seconds.</p>
            </CardContent>
          </Card>
        ) : null}

        {!loading && error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">WiFi code is on the way</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                className="w-full"
                onClick={() => {
                  setError(null)
                  setLoading(true)
                  setVoucherCode("")
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

        {!loading && !error && voucherCode ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Connect to WiFi</CardTitle>
              <CardDescription>
                {packageName}. Enter the code below and tap Connect to WiFi. You can share this code
                with someone else.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <HotspotConnectForm
                defaultCode={voucherCode}
                loginUrl={portal.login_url}
                origUrl={portal.orig_url}
                authorizeUrl={authorizeUrl}
              />
              <p className="text-muted-foreground text-sm">
                {smsSent
                  ? "We also texted this code to the phone number you paid with."
                  : "Save this code. If SMS did not arrive, use Look up by phone with the number you paid with."}
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/retrieve-voucher">Look up by phone</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
