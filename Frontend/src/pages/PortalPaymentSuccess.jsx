import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Loader2, Satellite } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getDefaultAppName } from "@/lib/env.js"
import {
  clearPersistedPortalParams,
  resolvePortalParams,
} from "@/lib/captivePortalParams.js"
import { authorizePortalRadiusWithRetry, completePortalPaymentWithRetry } from "@/lib/portalApi.js"

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

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(/** @type {string | null} */ (null))
  const [redirecting, setRedirecting] = React.useState(false)

  React.useEffect(() => {
    document.title = "Connecting to WiFi"
  }, [])

  React.useEffect(() => {
    if (!paymentReference) {
      setLoading(false)
      setError("Missing payment reference. Reconnect to the WiFi hotspot and try again from the splash page.")
      return
    }

    const portalParams = resolvePortalParams(searchParams)
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)

      const result = await completePortalPaymentWithRetry(paymentReference)
      if (cancelled) return
      if (!result.ok) {
        setError(result.error)
        setLoading(false)
        return
      }

      console.log("[portal] requesting hotspot authorization")
      const radius = await authorizePortalRadiusWithRetry(paymentReference, portalParams)
      if (cancelled) return

      if (radius.ok && radius.authorizeUrl) {
        console.log("[portal] hotspot authorize success", radius.authorizeUrl)
        console.log("[portal] redirecting to Grandstream authorizeUrl")
        setRedirecting(true)
        clearPersistedPortalParams()
        window.location.href = radius.authorizeUrl
        return
      }

      setError(
        radius.error ||
          "Payment succeeded but WiFi authorization failed. Please contact support with your payment phone number.",
      )
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchKey stabilizes URLSearchParams identity
  }, [paymentReference, searchKey])

  return (
    <div className="text-foreground relative flex min-h-svh flex-col items-center justify-center bg-canvas px-4 py-8 dark:bg-background">
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="bg-primary/10 mx-auto mb-3 flex size-12 items-center justify-center rounded-xl">
            <Satellite className="text-primary size-6" aria-hidden />
          </div>
          <p className="text-primary text-xs font-semibold uppercase tracking-widest">{appName}</p>
        </div>

        {loading || redirecting ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="text-primary size-10 animate-spin" aria-hidden />
              <p className="text-sm font-medium">
                {redirecting ? "Connecting you to WiFi…" : "Confirming your payment…"}
              </p>
              <p className="text-muted-foreground text-xs">This may take a few seconds.</p>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !redirecting && error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Could not connect automatically</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button asChild className="w-full">
                <Link to="/buy">Try again</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
