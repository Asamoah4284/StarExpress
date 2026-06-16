import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { CheckCircle2, Copy, Loader2, Satellite } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getDefaultAppName } from "@/lib/env.js"
import { completePortalPaymentWithRetry } from "@/lib/portalApi.js"

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
  const [voucherCode, setVoucherCode] = React.useState("")
  const [packageName, setPackageName] = React.useState("")
  const [smsSent, setSmsSent] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    document.title = "Payment successful"
  }, [])

  React.useEffect(() => {
    if (!paymentReference) {
      setLoading(false)
      setError("Missing payment reference. If you completed payment, use Retrieve voucher with your phone number.")
      return
    }

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
      setVoucherCode(result.voucherCode)
      setPackageName(result.packageName)
      setSmsSent(result.smsSent)
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [paymentReference])

  const handleCopy = async () => {
    if (!voucherCode) return
    try {
      await navigator.clipboard.writeText(voucherCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

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
              <p className="text-sm font-medium">Confirming your payment…</p>
              <p className="text-muted-foreground text-center text-xs">
                Approve the MoMo prompt on your phone. Your voucher will appear here automatically.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {!loading && error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Almost there</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button asChild className="w-full">
                <Link to="/retrieve-voucher">Retrieve voucher by phone</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link to="/buy">Buy another package</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !error && voucherCode ? (
          <Card>
            <CardHeader className="text-center">
              <CheckCircle2 className="text-primary mx-auto mb-2 size-12" aria-hidden />
              <CardTitle className="text-xl">Payment successful</CardTitle>
              <CardDescription>
                {packageName ? `${packageName} — ` : ""}
                use this voucher to connect to WiFi.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted rounded-lg px-4 py-5 text-center">
                <p className="text-muted-foreground mb-1 text-xs uppercase tracking-wider">Voucher code</p>
                <p className="font-mono text-2xl font-bold tracking-wide">{voucherCode}</p>
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={() => void handleCopy()}>
                <Copy className="mr-2 size-4" aria-hidden />
                {copied ? "Copied!" : "Copy code"}
              </Button>
              {smsSent ? (
                <p className="text-muted-foreground text-center text-sm">We also sent this code to your phone by SMS.</p>
              ) : (
                <p className="text-muted-foreground text-center text-sm">
                  Save this code — SMS delivery may be delayed. You can also retrieve it later by phone.
                </p>
              )}
              <Button asChild variant="ghost" className="w-full">
                <Link to="/retrieve-voucher">Retrieve voucher later</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
